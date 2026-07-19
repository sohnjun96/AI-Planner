import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { NoteCard } from "../components/NoteCard";
import { NoteConnections } from "../components/NoteConnections";
import { NoteEditor, type NoteEditorOverlay } from "../components/NoteEditor";
import { NoteHistoryPanel } from "../components/NoteHistoryPanel";
import { NoteMetaModal } from "../components/NoteMetaModal";
import { NoteActionModal, type ConfirmedAction } from "../components/NoteActionModal";
import { ProjectNoteTree, type NoteFilterNode } from "../components/ProjectNoteTree";
import { showToast } from "../components/ToastHost";
import { isAbortError } from "../agent/agentUtils";
import { generationOptionsFromSetting } from "../agent/llmClient";
import {
  classifyNoteWithAi,
  extractNoteActions,
  runNotesAgent,
  suggestRelatedNotes,
  suggestTasksForNote,
  type NoteActionItem,
  type NotesAgentProgress,
} from "../agent/notesAgent";
import {
  DEFAULT_PROJECT_ID,
  MAX_NOTE_TASK_SUGGESTIONS,
  NOTE_SUGGESTION_DATE_WINDOW_DAYS,
} from "../constants";
import { useAppData } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { Note, NoteAiAction, NoteFormInput, NoteStatus, NoteVersion, NoteVersionEditType } from "../models";
import { deriveNoteTitle, isAutoTitle, isFollowingTitle } from "../utils/noteTitle";

interface AiProposal {
  content: string;
  title?: string;
  editType: NoteVersionEditType;
  prompt: string;
  headline: string;
}

function noteToInput(note: Note): NoteFormInput {
  return {
    title: note.title,
    content: note.content,
    projectId: note.projectId,
    subcategoryId: note.subcategoryId,
    tags: [...note.tags],
    status: note.status,
    isPinned: note.isPinned,
  };
}

function tagsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function isDraftDifferentFromNote(note: Note, draft: NoteFormInput): boolean {
  return (
    note.title !== draft.title ||
    note.content !== draft.content ||
    note.projectId !== draft.projectId ||
    (note.subcategoryId ?? "") !== (draft.subcategoryId ?? "") ||
    note.status !== draft.status ||
    note.isPinned !== draft.isPinned ||
    !tagsEqual(note.tags, draft.tags)
  );
}

const AUTOSAVE_DELAY_MS = 1000;

export function NotesPage() {
  const {
    notes,
    noteVersions,
    tasks,
    taskTypes,
    projects,
    projectSubcategories,
    setting,
    createNote,
    createTask,
    updateNote,
    applyNoteAiClassification,
    removeNote,
    restoreNoteVersion,
    linkNoteToTask,
    unlinkNoteFromTask,
    createSubcategory,
    reorderNotes,
  } = useAppData();

  const navigate = useNavigate();

  const [filterNode, setFilterNode] = useState<NoteFilterNode>({ kind: "all" });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null);
  const [editorEntryMode, setEditorEntryMode] = useState<"edit" | "read">("read");
  const [editorEntryRevision, setEditorEntryRevision] = useState(0);
  const [draft, setDraft] = useState<NoteFormInput | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  // 타이핑 중 전체 노트 스캔이 입력을 막지 않도록 검색어 반영을 지연시킨다
  const deferredSearch = useDeferredValue(search);
  // 노트가 수백 개여도 DOM이 무거워지지 않게 목록을 점진적으로 렌더링한다
  const [visibleLimit, setVisibleLimit] = useState(80);
  // 탐색기 접기 — 편집에 집중할 때 본문에 전체 폭을 준다 (새로고침 후에도 유지)
  const [explorerCollapsed, setExplorerCollapsed] = useState(() => {
    try {
      return localStorage.getItem("notes_explorer_collapsed") === "1";
    } catch {
      return false;
    }
  });

  const setExplorerCollapsedPersisted = useCallback((next: boolean) => {
    setExplorerCollapsed(next);
    try {
      localStorage.setItem("notes_explorer_collapsed", next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
  const [classificationRevision, setClassificationRevision] = useState(0);
  const [compareVersion, setCompareVersion] = useState<NoteVersion | null>(null);
  const [actionItems, setActionItems] = useState<NoteActionItem[] | null>(null);
  const [isCreatingActions, setIsCreatingActions] = useState(false);

  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number } | null>(null);
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; noteId: string } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const loadedNoteIdRef = useRef<string | null>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const abortRef = useRef<AbortController | null>(null);
  // 노트 전환/페이지 이탈 시점에 미저장 수정분을 플러시하기 위한 최신 상태 미러
  const draftRef = useRef<NoteFormInput | null>(null);
  const notesRef = useRef<Note[]>(notes);
  const stackItemRefs = useRef(new Map<string, HTMLElement>());
  const classificationInFlightRef = useRef(false);
  const classificationAttemptedRef = useRef(new Set<string>());

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  // 미저장 수정분이 있으면 조용히 자동 저장한다 (전환·이탈로 인한 유실 방지)
  const flushPendingDraft = useCallback(() => {
    const pendingId = loadedNoteIdRef.current;
    const pendingDraft = draftRef.current;
    if (!pendingId || !pendingDraft) {
      return;
    }
    const pendingNote = notesRef.current.find((note) => note.id === pendingId);
    if (pendingNote && isDraftDifferentFromNote(pendingNote, pendingDraft)) {
      void updateNote(pendingId, pendingDraft, "autosave");
    }
  }, [updateNote]);

  // 노트 탭을 떠날 때(언마운트) 마지막 수정분 저장
  useEffect(() => {
    return () => {
      flushPendingDraft();
    };
  }, [flushPendingDraft]);

  // 새 AI 요청 시작: 진행 중이던 요청은 중단한다.
  const beginAiRequest = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const activeProjectId = useMemo(
    () => projects.find((project) => project.isActive)?.id ?? projects[0]?.id ?? DEFAULT_PROJECT_ID,
    [projects],
  );
  const hasApiConfig = Boolean((setting.llmEndpoint ?? "").trim());
  const generationOptions = useMemo(
    () => generationOptionsFromSetting(setting),
    [setting],
  );
  const aiActions: NoteAiAction[] = setting.noteAiActions ?? [];

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const taskMap = useMemo(() => Object.fromEntries(tasks.map((task) => [task.id, task])), [tasks]);
  const subMap = useMemo(
    () => Object.fromEntries(projectSubcategories.map((sub) => [sub.id, sub])),
    [projectSubcategories],
  );

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );
  const historyDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: historyOpen && Boolean(selectedNote),
    onClose: () => setHistoryOpen(false),
  });

  // 선택 노트가 바뀔 때만 draft 로드 (live query 지연 대응)
  useEffect(() => {
    if (!selectedNote) {
      // 선택 해제 시에도 미저장분이 있으면 저장 (삭제된 노트는 flush 내부에서 걸러진다)
      flushPendingDraft();
      loadedNoteIdRef.current = null;
      setDraft(null);
      return;
    }
    if (loadedNoteIdRef.current !== selectedNote.id) {
      // 다른 노트로 전환: 이전 노트의 수정분을 먼저 자동 저장해 유실을 막는다
      flushPendingDraft();
      loadedNoteIdRef.current = selectedNote.id;
      setDraft(noteToInput(selectedNote));
      setAiProposal(null);
      setCompareVersion(null);
      setMetaModalOpen(false);
      setHistoryOpen(false);
      setSavedMessage("");
      setErrorMessage("");
      setAiError("");
      setAiProgress("");
    }
  }, [selectedNote, flushPendingDraft]);

  useEffect(() => {
    if (selectedNoteId && !notes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(null);
      setFocusedNoteId((current) => (current === selectedNoteId ? null : current));
    }
  }, [notes, selectedNoteId]);

  // 다른 탭(일정)에서 노트로 바로가기
  useEffect(() => {
    const handleFocusNote = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      if (detail?.noteId) {
        setFilterNode({ kind: "all" });
        setFocusedNoteId(detail.noteId);
        setSelectedNoteId(detail.noteId);
      }
    };
    window.addEventListener("ai-planner:focus-note", handleFocusNote);
    return () => window.removeEventListener("ai-planner:focus-note", handleFocusNote);
  }, []);

  // 백그라운드 자동화: 미선택 노트의 기본 제목을 본문 첫 줄에서 생성한다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const note of notes) {
          // 선택 중이거나 보관된 노트는 자동 제목/분류 대상에서 제외
          if (note.id === selectedNoteId || note.status === "archived") {
            continue;
          }
          if (isAutoTitle(note.title)) {
            const derived = deriveNoteTitle(note.content);
            if (derived && derived !== note.title) {
              await updateNote(note.id, { ...noteToInput(note), title: derived });
            }
          }
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [notes, selectedNoteId, updateNote]);

  // 본문이 작성된 노트는 선택이 끝난 뒤 AI로 프로젝트/세부 항목을 최초 1회만 분류한다.
  useEffect(() => {
    if (!hasApiConfig || classificationInFlightRef.current) {
      return;
    }
    const candidate = notes.find(
      (note) =>
        !note.aiClassifiedAt &&
        note.id !== selectedNoteId &&
        note.status !== "archived" &&
        note.content.trim().length > 0 &&
        !classificationAttemptedRef.current.has(note.id),
    );
    if (!candidate) {
      return;
    }

    const timer = window.setTimeout(() => {
      classificationInFlightRef.current = true;
      classificationAttemptedRef.current.add(candidate.id);
      void classifyNoteWithAi({
        note: candidate,
        projects,
        subcategories: projectSubcategories,
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
      })
        .then((classification) =>
          applyNoteAiClassification(candidate.id, classification.projectId, classification.subcategoryId, candidate.updatedAt),
        )
        .catch((error) => {
          console.warn("AI note classification failed", error);
        })
        .finally(() => {
          classificationInFlightRef.current = false;
          setClassificationRevision((value) => value + 1);
        });
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [
    notes,
    selectedNoteId,
    hasApiConfig,
    projects,
    projectSubcategories,
    setting.llmEndpoint,
    setting.llmApiKey,
    setting.llmModel,
    generationOptions,
    applyNoteAiClassification,
    classificationRevision,
  ]);

  // 모든 노트의 미완료 체크리스트 항목 집계 (보관된 노트 제외)
  const openChecklistItems = useMemo(() => {
    const items: Array<{ noteId: string; noteTitle: string; projectColor: string; lineIndex: number; text: string }> = [];
    for (const note of notes) {
      if (note.status === "archived") {
        continue;
      }
      const lines = note.content.replace(/\r\n/g, "\n").split("\n");
      lines.forEach((line, lineIndex) => {
        const match = line.match(/^\s*[-*+]\s+\[ \]\s+(.+)$/);
        if (match) {
          items.push({
            noteId: note.id,
            noteTitle: note.title,
            projectColor: projectMap[note.projectId]?.color ?? "var(--body-muted)",
            lineIndex,
            text: match[1].trim().replace(/(\*\*|__|~~|`)/g, ""),
          });
        }
      });
    }
    return items;
  }, [notes, projectMap]);

  const filteredNotes = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    return notes
      .filter((note) => {
        // 보관된 노트는 '보관됨' 뷰에서만 보인다 — 일반 뷰를 깔끔하게 유지
        const isArchived = note.status === "archived";
        switch (filterNode.kind) {
          case "archived":
            if (!isArchived) return false;
            break;
          case "all":
            if (isArchived) return false;
            break;
          case "pinned":
            if (!note.isPinned || isArchived) return false;
            break;
          case "checklist":
            return false;
          case "project":
            if (note.projectId !== filterNode.projectId || isArchived) return false;
            break;
          case "subcategory":
            if (note.subcategoryId !== filterNode.subcategoryId || isArchived) return false;
            break;
          case "uncategorized":
            if (note.projectId !== filterNode.projectId || note.subcategoryId || isArchived) return false;
            break;
        }
        if (keyword) {
          const haystack = `${note.title} ${note.content} ${note.tags.join(" ")}`.toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) {
          return a.isPinned ? -1 : 1;
        }
        // 드래그로 정한 순서 우선. 순서가 없는 노트(-1)는 최근 수정순으로 맨 위 그룹에 온다
        const orderA = a.sortOrder ?? -1;
        const orderB = b.sortOrder ?? -1;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [notes, filterNode, deferredSearch]);

  // 일반 뷰에서 검색했는데 보관함에만 일치가 있으면 안내한다 ("노트가 사라졌다" 혼란 방지)
  const archivedMatchCount = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    if (!keyword || filterNode.kind === "archived") return 0;
    return notes.filter(
      (note) =>
        note.status === "archived" &&
        `${note.title} ${note.content} ${note.tags.join(" ")}`.toLowerCase().includes(keyword),
    ).length;
  }, [notes, deferredSearch, filterNode]);

  // 필터/검색이 바뀌면 점진 렌더링 한도를 초기화
  useEffect(() => {
    setVisibleLimit(80);
  }, [filterNode, deferredSearch]);

  const visibleNotes = useMemo(() => filteredNotes.slice(0, visibleLimit), [filteredNotes, visibleLimit]);

  // 카테고리 선택 시 노트들을 이어서 보여주는 스택 뷰 — 점진 렌더링 한도
  const [stackLimit, setStackLimit] = useState(20);

  useEffect(() => {
    setStackLimit(20);
  }, [filterNode]);

  useEffect(() => {
    if (!focusedNoteId) {
      return;
    }
    const index = filteredNotes.findIndex((note) => note.id === focusedNoteId);
    if (index < 0) {
      return;
    }
    if (index >= stackLimit) {
      setStackLimit(index + 1);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      stackItemRefs.current.get(focusedNoteId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedNoteId, filteredNotes, stackLimit]);

  function focusNoteInStack(noteId: string) {
    setFocusedNoteId(noteId);
  }

  function editNoteInStack(noteId: string) {
    setFocusedNoteId(noteId);
    setEditorEntryMode("edit");
    setEditorEntryRevision((revision) => revision + 1);
    setSelectedNoteId(noteId);
  }

  // 탐색기 카드 드래그로 순서 변경 — 검색 중에는 부분 목록이라 비활성화
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragOverNoteId, setDragOverNoteId] = useState<string | null>(null);
  const isNoteDragEnabled = !search.trim() && filterNode.kind !== "checklist";

  function handleNoteDrop(targetId: string) {
    const draggedId = dragNoteId;
    setDragNoteId(null);
    setDragOverNoteId(null);
    if (!draggedId || draggedId === targetId) {
      return;
    }
    // 끌어온 카드가 대상 카드의 자리를 차지 (array-move)
    const ids = filteredNotes.map((note) => note.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    void reorderNotes(ids);
  }

  function moveNoteByOffset(noteId: string, offset: -1 | 1) {
    if (!isNoteDragEnabled) {
      return;
    }
    const ids = filteredNotes.map((note) => note.id);
    const fromIndex = ids.indexOf(noteId);
    const toIndex = fromIndex + offset;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= ids.length) {
      return;
    }
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, noteId);
    void reorderNotes(ids);
  }

  const selectedVersions = useMemo(
    () => noteVersions.filter((version) => version.noteId === selectedNoteId),
    [noteVersions, selectedNoteId],
  );

  const linkedTasks = useMemo(() => {
    if (!selectedNote) return [];
    return selectedNote.linkedTaskIds
      .map((id) => taskMap[id])
      .filter((task): task is NonNullable<typeof task> => Boolean(task));
  }, [selectedNote, taskMap]);

  const suggestions = useMemo(() => {
    if (!selectedNote) return [];
    return suggestTasksForNote({
      noteTitle: selectedNote.title,
      noteContent: selectedNote.content,
      noteProjectId: selectedNote.projectId,
      noteCreatedAt: selectedNote.createdAt,
      tasks,
      excludeTaskIds: selectedNote.linkedTaskIds,
      dateWindowDays: NOTE_SUGGESTION_DATE_WINDOW_DAYS,
      limit: MAX_NOTE_TASK_SUGGESTIONS,
    })
      .map((item) => ({ task: taskMap[item.taskId], reason: item.reason }))
      .filter((item): item is { task: NonNullable<typeof item.task>; reason: string } => Boolean(item.task));
  }, [selectedNote, tasks, taskMap]);

  const relatedNotes = useMemo(() => {
    if (!selectedNote) return [];
    const noteMap = Object.fromEntries(notes.map((note) => [note.id, note]));
    return suggestRelatedNotes({ note: selectedNote, notes, limit: 5 })
      .map((item) => ({ note: noteMap[item.noteId], reason: item.reason }))
      .filter((item): item is { note: Note; reason: string } => Boolean(item.note));
  }, [selectedNote, notes]);

  const isDirty = useMemo(() => {
    if (!selectedNote || !draft) return false;
    return isDraftDifferentFromNote(selectedNote, draft);
  }, [selectedNote, draft]);

  // 입력이 멈추면 자동 저장 — 저장 버튼을 안 눌러도 수정분이 유실되지 않는다
  useEffect(() => {
    if (!selectedNoteId || !draft || !isDirty || isSaving) {
      return;
    }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await updateNote(selectedNoteId, draft, "autosave");
          setSavedMessage("자동 저장됨");
          window.setTimeout(() => setSavedMessage(""), 1500);
        } catch {
          // 자동 저장 실패는 조용히 넘기고 다음 변경/수동 저장에서 재시도한다
        }
      })();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [selectedNoteId, draft, isDirty, isSaving, updateNote]);

  const currentSubcategoryName = draft?.subcategoryId ? subMap[draft.subcategoryId]?.name : undefined;
  const currentProject = draft ? projectMap[draft.projectId] : undefined;

  const editorOverlay: NoteEditorOverlay | null = useMemo(() => {
    if (!selectedNote) return null;
    if (aiProposal) {
      return {
        previous: selectedNote.content,
        next: aiProposal.content,
        headline: aiProposal.headline,
        mode: "proposal",
        isApplying: isSaving,
      };
    }
    if (compareVersion) {
      return {
        previous: compareVersion.content,
        next: selectedNote.content,
        headline: "선택 버전 → 현재",
        mode: "compare",
      };
    }
    return null;
  }, [selectedNote, aiProposal, compareVersion, isSaving]);

  async function handleCreateNote() {
    const base: NoteFormInput = {
      title: "새 노트",
      content: "",
      projectId: activeProjectId,
      subcategoryId: undefined,
      tags: [],
      status: "draft",
      isPinned: false,
    };
    if (filterNode.kind === "project") {
      base.projectId = filterNode.projectId;
    } else if (filterNode.kind === "subcategory") {
      base.projectId = filterNode.projectId;
      base.subcategoryId = filterNode.subcategoryId;
    } else if (filterNode.kind === "uncategorized") {
      base.projectId = filterNode.projectId;
    }
    const id = await createNote(base);
    editNoteInStack(id);
  }

  async function handleSave(editType: NoteVersionEditType = "manual") {
    if (!selectedNoteId || !draft) return;
    setIsSaving(true);
    setErrorMessage("");
    try {
      await updateNote(selectedNoteId, draft, editType);
      setSavedMessage("저장했습니다.");
      window.setTimeout(() => setSavedMessage(""), 2000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApplyMeta(patch: Partial<NoteFormInput>) {
    if (!selectedNoteId || !draft) return;
    const nextInput: NoteFormInput = { ...draft, ...patch };
    setDraft(nextInput);
    try {
      await updateNote(selectedNoteId, nextInput);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  }

  async function handleDelete() {
    if (!selectedNoteId) return;
    if (!window.confirm("이 노트를 삭제할까요? 되돌릴 수 없습니다.")) return;
    await removeNote(selectedNoteId);
    setSelectedNoteId(null);
    setFocusedNoteId(null);
    showToast("노트를 삭제했습니다.");
  }

  // 체크박스 토글 → 해당 노트 본문 반영 + 저장 (선택 노트/집계 뷰 공용)
  async function toggleChecklistLine(noteId: string, lineIndex: number, checked: boolean) {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    const lines = note.content.replace(/\r\n/g, "\n").split("\n");
    const line = lines[lineIndex];
    if (line == null) return;
    const replaced = line.replace(/^(\s*[-*+]\s+\[)[ xX](\]\s+)/, `$1${checked ? "x" : " "}$2`);
    if (replaced === line) return;
    lines[lineIndex] = replaced;
    const nextContent = lines.join("\n");
    if (noteId === selectedNoteId && draft) {
      setDraft({ ...draft, content: nextContent });
    }
    try {
      await updateNote(noteId, { ...noteToInput(note), content: nextContent });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    }
  }

  function handleToggleChecklist(lineIndex: number, checked: boolean) {
    if (!selectedNoteId) return;
    void toggleChecklistLine(selectedNoteId, lineIndex, checked);
  }

  async function setNoteStatus(noteId: string, status: NoteStatus) {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    await updateNote(noteId, { ...noteToInput(note), status });
  }

  async function handleDeleteNote(noteId: string) {
    if (!window.confirm("이 노트를 삭제할까요? 되돌릴 수 없습니다.")) return;
    await removeNote(noteId);
    if (selectedNoteId === noteId) setSelectedNoteId(null);
    if (focusedNoteId === noteId) setFocusedNoteId(null);
    showToast("노트를 삭제했습니다.");
  }

  async function handleSummarizeNote(noteId: string) {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    const controller = beginAiRequest();
    setIsAiRunning(true);
    setAiError("");
    try {
      const result = await runNotesAgent({
        mode: "summarize",
        userMessage: "이 노트를 요약해줘",
        targetNotes: [{ id: note.id, title: note.title, content: note.content }],
        notes,
        tasks,
        projects,
        taskTypes: [],
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
        noteAiRules: setting.noteAiRules,
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (result.proposedContent) {
        const id = await createNote(
          {
            title: result.proposedTitle?.trim() || `요약: ${note.title}`,
            content: result.proposedContent,
            projectId: note.projectId,
            subcategoryId: note.subcategoryId,
            tags: ["요약"],
            status: "active",
            isPinned: false,
          },
          "ai_full",
          "노트 요약",
        );
        editNoteInStack(id);
      } else {
        setAiError(result.assistantMessage || "요약 결과를 만들지 못했습니다.");
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setAiError(error instanceof Error ? error.message : "요약에 실패했습니다.");
    } finally {
      if (abortRef.current === controller) {
        setIsAiRunning(false);
      }
    }
  }

  function buildCardMenuItems(noteId: string): ContextMenuItem[] {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return [];
    const items: ContextMenuItem[] = [
      { id: "summarize", label: "AI 요약", description: "요약 노트 생성", disabled: !hasApiConfig, onSelect: () => void handleSummarizeNote(noteId) },
      { id: "pin", label: note.isPinned ? "고정 해제" : "고정", onSelect: () => void updateNote(noteId, { ...noteToInput(note), isPinned: !note.isPinned }) },
    ];
    const noteIndex = filteredNotes.findIndex((item) => item.id === noteId);
    if (isNoteDragEnabled && noteIndex >= 0) {
      items.push(
        {
          id: "move-up",
          label: "위로 이동",
          description: "노트 순서를 한 칸 위로 이동",
          disabled: noteIndex === 0,
          onSelect: () => moveNoteByOffset(noteId, -1),
        },
        {
          id: "move-down",
          label: "아래로 이동",
          description: "노트 순서를 한 칸 아래로 이동",
          disabled: noteIndex === filteredNotes.length - 1,
          onSelect: () => moveNoteByOffset(noteId, 1),
        },
      );
    }
    if (note.status !== "active") {
      items.push({ id: "activate", label: "활성화", onSelect: () => void setNoteStatus(noteId, "active") });
    }
    if (note.status !== "draft") {
      items.push({ id: "draft", label: "초안으로", onSelect: () => void setNoteStatus(noteId, "draft") });
    }
    if (note.status !== "archived") {
      items.push({ id: "archive", label: "보관", onSelect: () => void setNoteStatus(noteId, "archived") });
    }
    items.push({ id: "delete", label: "삭제", tone: "danger", onSelect: () => void handleDeleteNote(noteId) });
    return items;
  }

  const handleAiProgress = useCallback((info: NotesAgentProgress) => {
    setAiProgress(info.phase === "writing" ? `${info.label}… ${info.chars ?? 0}자` : `${info.label} 조회 중…`);
  }, []);

  const runEditAgent = useCallback(
    async (prompt: string) => {
      if (!selectedNote || !draft) return;
      const controller = beginAiRequest();
      setIsAiRunning(true);
      setAiProgress("AI 준비 중…");
      setAiError("");
      try {
        const result = await runNotesAgent({
          mode: "edit",
          userMessage: prompt,
          activeNote: { id: selectedNote.id, title: draft.title, content: draft.content, projectId: draft.projectId },
          notes,
          tasks,
          projects,
          taskTypes: [],
          endpoint: setting.llmEndpoint,
          apiKey: setting.llmApiKey ?? "",
          model: setting.llmModel,
          generationOptions,
          noteAiRules: setting.noteAiRules,
          onProgress: handleAiProgress,
          signal: controller.signal,
        });
        setAiProgress(result.trace ? `AI 참고: ${result.trace}` : "");
        if (result.proposedContent && result.proposedContent !== draft.content) {
          setAiProposal({
            content: result.proposedContent,
            title: result.proposedTitle,
            editType: "ai_full",
            prompt,
            headline: result.assistantMessage || "AI 편집 제안",
          });
        } else {
          setAiError(result.assistantMessage || "변경할 내용을 찾지 못했습니다.");
        }
      } catch (error) {
        if (isAbortError(error)) return;
        setAiProgress("");
        setAiError(error instanceof Error ? error.message : "AI 편집에 실패했습니다.");
      } finally {
        if (abortRef.current === controller) {
          setIsAiRunning(false);
        }
      }
    },
    [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel, generationOptions, setting.noteAiRules, handleAiProgress, beginAiRequest],
  );

  const runInlineAssist = useCallback(async () => {
    if (!selectedNote || !draft) return;
    const { start, end } = selectionRef.current;
    if (start === end) {
      setAiError("먼저 편집할 텍스트를 선택해 주세요.");
      return;
    }
    const selectedText = draft.content.slice(start, end);
    const noteIdAtRequest = selectedNote.id;
    const prompt = window.prompt("선택한 텍스트를 어떻게 편집할까요?", "더 명확하게 다듬어줘");
    if (!prompt) return;

    const controller = beginAiRequest();
    setIsAiRunning(true);
    setAiProgress("AI 준비 중…");
    setAiError("");
    try {
      const result = await runNotesAgent({
        mode: "inline_edit",
        userMessage: prompt,
        activeNote: {
          id: selectedNote.id,
          title: draft.title,
          content: draft.content,
          projectId: draft.projectId,
          selectedContext: { before: draft.content.slice(Math.max(0, start - 800), start), after: draft.content.slice(end, end + 800) },
        },
        selectedText,
        notes,
        tasks,
        projects,
        taskTypes: [],
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
        noteAiRules: setting.noteAiRules,
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      setAiProgress(result.trace ? `AI 참고: ${result.trace}` : "");
      // An empty replacement is a valid AI edit (delete the selection).
      if (result.replacementText !== undefined && selectedNote.id === noteIdAtRequest) {
        const nextContent = draft.content.slice(0, start) + result.replacementText + draft.content.slice(end);
        setAiProposal({ content: nextContent, editType: "ai_inline", prompt, headline: "AI 인라인 편집 제안" });
      } else {
        setAiError(result.assistantMessage || "변경할 내용을 찾지 못했습니다.");
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setAiError(error instanceof Error ? error.message : "AI 편집에 실패했습니다.");
    } finally {
      if (abortRef.current === controller) {
        setIsAiRunning(false);
      }
    }
  }, [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel, generationOptions, setting.noteAiRules, handleAiProgress, beginAiRequest]);

  async function acceptProposal() {
    if (!selectedNoteId || !draft || !aiProposal) return;
    const nextInput: NoteFormInput = {
      ...draft,
      content: aiProposal.content,
      title: aiProposal.title?.trim() || draft.title,
    };
    setIsSaving(true);
    try {
      await updateNote(selectedNoteId, nextInput, aiProposal.editType, aiProposal.prompt);
      setDraft(nextInput);
      setAiProposal(null);
      setSavedMessage("AI 변경을 반영했습니다.");
      window.setTimeout(() => setSavedMessage(""), 2000);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "적용에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExtractActions() {
    if (!selectedNote) return;
    const controller = beginAiRequest();
    setIsAiRunning(true);
    setAiProgress("AI 준비 중…");
    setAiError("");
    try {
      const result = await extractNoteActions({
        noteTitle: selectedNote.title,
        noteContent: selectedNote.content,
        nowIso: new Date().toISOString(),
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      setAiProgress("");
      if (result.length === 0) {
        setAiError("추출할 액션 아이템을 찾지 못했습니다.");
      } else {
        setActionItems(result);
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setAiProgress("");
      setAiError(error instanceof Error ? error.message : "액션 추출에 실패했습니다.");
    } finally {
      if (abortRef.current === controller) {
        setIsAiRunning(false);
      }
    }
  }

  async function handleCreateActions(actions: ConfirmedAction[]) {
    if (!selectedNote) return;
    setIsCreatingActions(true);
    try {
      const defaultTypeId = taskTypes.find((type) => type.isActive)?.id ?? taskTypes[0]?.id ?? "";
      for (const action of actions) {
        const taskId = await createTask({
          title: action.title,
          content: action.content ?? "",
          taskTypeId: defaultTypeId,
          projectId: selectedNote.projectId,
          status: "NOT_DONE",
          startAt: action.startAtIso,
          isMajor: false,
        });
        if (taskId) {
          await linkNoteToTask(selectedNote.id, taskId, "manual");
        }
      }
      setActionItems(null);
      setSavedMessage(`일정 ${actions.length}건을 만들고 노트에 연결했습니다.`);
      window.setTimeout(() => setSavedMessage(""), 2500);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "일정 생성에 실패했습니다.");
    } finally {
      setIsCreatingActions(false);
    }
  }

  function handleContentContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    const textarea = textareaRef.current;
    if (textarea) {
      selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    } else {
      selectionRef.current = { start: 0, end: 0 };
    }
    setAiMenu({ x: event.clientX, y: event.clientY });
  }

  function buildAiMenuItems(): ContextMenuItem[] {
    const hasSelection = selectionRef.current.start !== selectionRef.current.end;
    const items: ContextMenuItem[] = aiActions.map((action, index) => ({
      id: `ai-${action.id}`,
      label: action.label,
      description: action.prompt.slice(0, 40),
      tone: index === 0 ? "primary" : "default",
      onSelect: () => void runEditAgent(action.prompt),
    }));
    if (hasSelection) {
      items.push({ id: "ai-inline", label: "선택 영역 편집", description: "선택한 부분만 AI 편집", onSelect: () => void runInlineAssist() });
    }
    items.push({
      id: "ai-custom",
      label: "직접 요청…",
      description: "원하는 편집을 입력",
      onSelect: () => {
        const prompt = window.prompt("AI에게 어떻게 편집할지 알려주세요.");
        if (prompt?.trim()) {
          void runEditAgent(prompt.trim());
        }
      },
    });
    items.push({
      id: "ai-extract",
      label: "📅 일정 추출",
      description: "할 일을 뽑아 일정으로",
      onSelect: () => void handleExtractActions(),
    });
    items.push({
      id: "ai-manage",
      label: "기능 관리…",
      description: "AI 편집 기능 추가·수정",
      onSelect: () => navigate("/settings?section=ai"),
    });
    return items;
  }

  // ✨AI 버튼: 우클릭과 동일한 메뉴를 버튼 바로 아래에 연다
  function handleOpenAiMenuButton(event: MouseEvent<HTMLElement>) {
    const textarea = textareaRef.current;
    selectionRef.current = textarea
      ? { start: textarea.selectionStart, end: textarea.selectionEnd }
      : { start: 0, end: 0 };
    const rect = event.currentTarget.getBoundingClientRect();
    setAiMenu({ x: rect.left, y: rect.bottom + 4 });
  }

  async function handleRestoreVersion(versionId: string) {
    if (!selectedNoteId) return;
    await restoreNoteVersion(selectedNoteId, versionId);
    loadedNoteIdRef.current = null;
    setCompareVersion(null);
    setHistoryOpen(false);
  }

  function handleOpenTask(taskId: string) {
    navigate("/dashboard");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("ai-planner:focus-task", { detail: { taskId } }));
    }, 80);
  }

  async function handleSummarizeSelected() {
    const targets = notes.filter((note) => checkedIds.has(note.id));
    if (targets.length === 0) return;
    const controller = beginAiRequest();
    setIsAiRunning(true);
    setAiError("");
    try {
      const result = await runNotesAgent({
        mode: "summarize",
        userMessage: "선택한 노트를 요약해줘",
        targetNotes: targets.map((note) => ({ id: note.id, title: note.title, content: note.content })),
        notes,
        tasks,
        projects,
        taskTypes: [],
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
        noteAiRules: setting.noteAiRules,
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (result.proposedContent) {
        const id = await createNote(
          {
            title: result.proposedTitle?.trim() || `요약 (${targets.length}개)`,
            content: result.proposedContent,
            projectId: targets[0].projectId,
            tags: ["요약"],
            status: "active",
            isPinned: false,
          },
          "ai_full",
          "선택 노트 요약",
        );
        setCheckedIds(new Set());
        editNoteInStack(id);
      } else {
        setAiError(result.assistantMessage || "요약 결과를 만들지 못했습니다.");
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setAiError(error instanceof Error ? error.message : "요약에 실패했습니다.");
    } finally {
      if (abortRef.current === controller) {
        setIsAiRunning(false);
      }
    }
  }

  async function handleMergeSelected() {
    const targets = notes.filter((note) => checkedIds.has(note.id));
    if (targets.length < 2) {
      setAiError("병합하려면 노트를 2개 이상 선택해 주세요.");
      return;
    }
    const controller = beginAiRequest();
    setIsAiRunning(true);
    setAiError("");
    try {
      const result = await runNotesAgent({
        mode: "merge",
        userMessage: "선택한 노트를 하나로 통합해줘",
        targetNotes: targets.map((note) => ({ id: note.id, title: note.title, content: note.content })),
        notes,
        tasks,
        projects,
        taskTypes: [],
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
        noteAiRules: setting.noteAiRules,
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (result.proposedContent) {
        const id = await createNote(
          {
            title: result.proposedTitle?.trim() || `통합 노트 (${targets.length}개)`,
            content: result.proposedContent,
            projectId: targets[0].projectId,
            tags: ["통합"],
            status: "active",
            isPinned: false,
          },
          "ai_full",
          "선택 노트 통합",
        );
        setCheckedIds(new Set());
        editNoteInStack(id);
      } else {
        setAiError(result.assistantMessage || "통합 결과를 만들지 못했습니다.");
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setAiError(error instanceof Error ? error.message : "통합에 실패했습니다.");
    } finally {
      if (abortRef.current === controller) {
        setIsAiRunning(false);
      }
    }
  }

  function toggleCheck(noteId: string, checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(noteId);
      else next.delete(noteId);
      return next;
    });
  }

  const checkedCount = checkedIds.size;

  const listTitle = useMemo(() => {
    switch (filterNode.kind) {
      case "all":
        return "전체 노트";
      case "pinned":
        return "고정된 노트";
      case "checklist":
        return "전체 체크리스트";
      case "archived":
        return "보관된 노트";
      case "project":
        return projectMap[filterNode.projectId]?.name ?? "프로젝트";
      case "subcategory":
        return subMap[filterNode.subcategoryId]?.name ?? "세부 항목";
      case "uncategorized":
        return `${projectMap[filterNode.projectId]?.name ?? "프로젝트"} · 미분류`;
    }
  }, [filterNode, projectMap, subMap]);

  return (
    <div className={`notes-workspace ${explorerCollapsed ? "explorer-collapsed" : ""}`}>
      {explorerCollapsed ? (
        /* 접힌 탐색기: 편집기 위 한 줄 바 — 검색을 시작하면 자동으로 펼쳐진다 */
        <div className="notes-collapsed-bar">
          <button
            type="button"
            className="notes-collapse-btn"
            onClick={() => setExplorerCollapsedPersisted(false)}
            title="탐색기 펼치기"
            aria-label="탐색기 펼치기"
          >
            »
          </button>
          <input
            className="notes-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              if (event.target.value.trim()) {
                setExplorerCollapsedPersisted(false);
              }
            }}
            placeholder={`노트 검색 · ${listTitle} ${filteredNotes.length}개`}
            aria-label="노트 검색"
          />
          <button type="button" className="btn btn-primary btn-compact" onClick={() => void handleCreateNote()}>
            + 새 노트
          </button>
        </div>
      ) : (
      /* 탐색기: 검색·트리·목록을 한 컬럼으로 — 편집기에 나머지 공간을 몰아준다 */
      <aside className="notes-explorer">
        <div className="notes-explorer-head">
          <input
            className="notes-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="노트 검색"
            aria-label="노트 검색"
          />
          <button type="button" className="btn btn-primary btn-compact" onClick={() => void handleCreateNote()}>
            + 새 노트
          </button>
          <button
            type="button"
            className="notes-collapse-btn"
            onClick={() => setExplorerCollapsedPersisted(true)}
            title="탐색기 접기"
            aria-label="탐색기 접기"
          >
            «
          </button>
        </div>

        <div className="notes-explorer-tree">
          <ProjectNoteTree
            projects={projects}
            subcategories={projectSubcategories}
            notes={notes}
            openChecklistCount={openChecklistItems.length}
            selected={filterNode}
            onSelect={(node) => {
              setFilterNode(node);
              // 카테고리를 고르면 단일 편집 대신 해당 노트들을 이어서 보여준다
              setSelectedNoteId(null);
              setFocusedNoteId(null);
            }}
            onAddSubcategory={(projectId, name) => void createSubcategory(projectId, name)}
          />
        </div>

        <div className="notes-explorer-label">
          <span>{listTitle}</span>
          <span className="notes-list-count">
            {filterNode.kind === "checklist" ? openChecklistItems.length : filteredNotes.length}
          </span>
        </div>

        {checkedCount > 0 ? (
          <div className="notes-bulk-bar">
            <span>{checkedCount}개 선택</span>
            <div className="button-row">
              <button type="button" className="btn btn-soft btn-compact" onClick={() => void handleSummarizeSelected()} disabled={isAiRunning || !hasApiConfig}>
                요약
              </button>
              <button type="button" className="btn btn-soft btn-compact" onClick={() => void handleMergeSelected()} disabled={isAiRunning || checkedCount < 2 || !hasApiConfig}>
                통합
              </button>
              <button type="button" className="btn btn-outline btn-compact" onClick={() => setCheckedIds(new Set())}>
                해제
              </button>
            </div>
          </div>
        ) : null}

        <div className="notes-explorer-list">
        {filterNode.kind === "checklist" ? (
          <div className="notes-checklist-view">
            {openChecklistItems.length === 0 ? (
              <p className="empty-text">미완료 체크리스트 항목이 없습니다.</p>
            ) : (
              openChecklistItems.map((item) => (
                <div key={`${item.noteId}-${item.lineIndex}`} className="global-check-item">
                  <input
                    type="checkbox"
                    checked={false}
                    aria-label={`${item.text} 완료`}
                    onChange={() => void toggleChecklistLine(item.noteId, item.lineIndex, true)}
                  />
                  <button
                    type="button"
                    className="global-check-body"
                    onClick={() => {
                      setFilterNode({ kind: "all" });
                      editNoteInStack(item.noteId);
                    }}
                    style={{ "--note-project-color": item.projectColor } as CSSProperties}
                  >
                    <span className="global-check-text">{item.text}</span>
                    <small className="global-check-note">{item.noteTitle}</small>
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="notes-list">
            {filteredNotes.length === 0 ? (
              <p className="empty-text">
                {filterNode.kind === "archived"
                  ? "보관된 노트가 없습니다. 노트의 더보기 메뉴에서 보관할 수 있어요."
                  : "노트가 없습니다. \"새 노트\"로 시작하세요."}
              </p>
            ) : (
              visibleNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  project={projectMap[note.projectId]}
                  isSelected={note.id === focusedNoteId || note.id === selectedNoteId}
                  isChecked={checkedIds.has(note.id)}
                  onSelect={() => focusNoteInStack(note.id)}
                  onOpenForEdit={() => editNoteInStack(note.id)}
                  onToggleCheck={(checked) => toggleCheck(note.id, checked)}
                  onOpenMenu={(pos) => setCardMenu({ x: pos.x, y: pos.y, noteId: note.id })}
                  draggable={isNoteDragEnabled}
                  dragging={dragNoteId === note.id}
                  dragOver={dragOverNoteId === note.id && dragNoteId !== note.id}
                  onDragStart={(event) => {
                    setDragNoteId(note.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", note.id);
                  }}
                  onDragOver={(event) => {
                    if (dragNoteId && dragNoteId !== note.id) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverNoteId(note.id);
                    }
                  }}
                  onDragLeave={() => {
                    setDragOverNoteId((prev) => (prev === note.id ? null : prev));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleNoteDrop(note.id);
                  }}
                  onDragEnd={() => {
                    setDragNoteId(null);
                    setDragOverNoteId(null);
                  }}
                />
              ))
            )}
            {filteredNotes.length > visibleLimit ? (
              <button
                type="button"
                className="btn btn-soft btn-compact notes-load-more"
                onClick={() => setVisibleLimit((limit) => limit + 120)}
              >
                노트 {filteredNotes.length - visibleLimit}개 더 보기
              </button>
            ) : null}
            {archivedMatchCount > 0 ? (
              <button type="button" className="notes-archived-hint" onClick={() => setFilterNode({ kind: "archived" })}>
                🗄 보관된 노트에서 {archivedMatchCount}개 일치 — 보관함에서 보기
              </button>
            ) : null}
          </div>
        )}
        </div>
      </aside>
      )}

      <section className="notes-detail-scroll" aria-label="노트 내용">
        {filterNode.kind === "checklist" ? (
          <section className="notes-checklist-main" aria-label="전체 체크리스트">
            <header className="notes-stack-head">
              <div>
                <p className="eyebrow">CHECKLIST</p>
                <h3>전체 체크리스트 {openChecklistItems.length}개</h3>
              </div>
              <span className="notes-stack-hint">체크하면 원본 노트에서도 완료 처리됩니다 · 항목을 누르면 원본 노트로 이동합니다</span>
            </header>
            {openChecklistItems.length === 0 ? (
              <div className="notes-checklist-empty">미완료 체크리스트 항목이 없습니다.</div>
            ) : (
              <div className="notes-checklist-main-list">
                {openChecklistItems.map((item) => (
                  <article key={`${item.noteId}-${item.lineIndex}`} className="global-check-item global-check-item-main">
                    <input
                      type="checkbox"
                      checked={false}
                      aria-label={`${item.text} 완료`}
                      onChange={() => void toggleChecklistLine(item.noteId, item.lineIndex, true)}
                    />
                    <button
                      type="button"
                      className="global-check-body"
                      onClick={() => {
                        setFilterNode({ kind: "all" });
                        editNoteInStack(item.noteId);
                      }}
                      style={{ "--note-project-color": item.projectColor } as CSSProperties}
                    >
                      <span className="global-check-text">{item.text}</span>
                      <small className="global-check-note">{item.noteTitle}</small>
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
        {filterNode.kind !== "checklist" && filteredNotes.length > 0 ? (
          <div className="notes-stack-view" aria-label={`${listTitle} 이어보기`}>
            <header className="notes-stack-head">
              <div>
                <p className="eyebrow">READ ALL</p>
                <h3>
                  {listTitle} {filteredNotes.length}개
                </h3>
              </div>
              <span className="notes-stack-hint">왼쪽 카드는 해당 위치로 이동 · 편집 버튼은 문맥을 유지한 채 바로 편집</span>
            </header>
            {filteredNotes.slice(0, stackLimit).map((note) => {
              const project = projectMap[note.projectId];
              const subName = note.subcategoryId ? subMap[note.subcategoryId]?.name : undefined;
              const isEditing = note.id === selectedNoteId && selectedNote && draft && currentProject;
              const commonStyle = {
                "--note-project-color": project?.color ?? "var(--body-muted)",
              } as CSSProperties;
              const setStackRef = (node: HTMLElement | null) => {
                if (node) stackItemRefs.current.set(note.id, node);
                else stackItemRefs.current.delete(note.id);
              };

              if (isEditing) {
                return (
                  <article key={note.id} ref={setStackRef} className="notes-detail-pane" style={commonStyle}>
                    <NoteEditor
                      key={`${selectedNote.id}-${editorEntryMode}-${editorEntryRevision}`}
                      draft={draft}
                      projectName={currentProject.name}
                      projectColor={currentProject.color}
                      subcategoryName={currentSubcategoryName}
                      aiEnabled={hasApiConfig}
                      isAiRunning={isAiRunning}
                      overlay={editorOverlay}
                      onAcceptOverlay={() => void acceptProposal()}
                      onRejectOverlay={() => {
                        setAiProposal(null);
                        setCompareVersion(null);
                        setAiProgress("");
                      }}
                      onToggleChecklist={(lineIndex, checked) => void handleToggleChecklist(lineIndex, checked)}
                      onOpenAiMenu={handleOpenAiMenuButton}
                      onChangeTitle={(value) => setDraft((prev) => (prev ? { ...prev, title: value } : prev))}
                      onChangeContent={(value) =>
                        setDraft((prev) => {
                          if (!prev) return prev;
                          const following = isFollowingTitle(prev.title, prev.content);
                          const nextTitle = following ? deriveNoteTitle(value) || "새 노트" : prev.title;
                          return { ...prev, content: value, title: nextTitle };
                        })
                      }
                      onSave={() => void handleSave("manual")}
                      onOpenMeta={() => setMetaModalOpen(true)}
                      onOpenHistory={() => setHistoryOpen(true)}
                      onDelete={() => void handleDelete()}
                      onContentContextMenu={handleContentContextMenu}
                      textareaRef={textareaRef}
                      isSaving={isSaving}
                      isDirty={isDirty}
                      savedMessage={savedMessage}
                      errorMessage={errorMessage}
                      historyCount={selectedVersions.length}
                      initialMode={editorEntryMode}
                    />

                    {isAiRunning ? (
                      <p className="note-ai-running" aria-live="polite">
                        <span className="note-ai-spinner" aria-hidden="true" />
                        {aiProgress || "AI가 처리 중입니다…"}
                      </p>
                    ) : aiProgress.startsWith("AI 참고") ? (
                      <p className="note-ai-trace">{aiProgress}</p>
                    ) : null}
                    {aiError ? <p className="error-text">{aiError}</p> : null}

                    <NoteConnections
                      linkedTasks={linkedTasks}
                      suggestions={suggestions}
                      relatedNotes={relatedNotes}
                      timeFormat={setting.timeFormat}
                      onOpenTask={handleOpenTask}
                      onOpenNote={(noteId) => editNoteInStack(noteId)}
                      onLink={(taskId) => void linkNoteToTask(selectedNote.id, taskId, "auto_suggest")}
                      onUnlink={(taskId) => void unlinkNoteFromTask(selectedNote.id, taskId)}
                      isBusy={isSaving}
                    />
                  </article>
                );
              }

              return (
                <article
                  key={note.id}
                  ref={setStackRef}
                  className={`notes-stack-item ${note.id === focusedNoteId ? "focused" : ""}`}
                  style={commonStyle}
                  onClick={() => focusNoteInStack(note.id)}
                  onDoubleClick={() => editNoteInStack(note.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setCardMenu({ x: event.clientX, y: event.clientY, noteId: note.id });
                  }}
                >
                  <header className="notes-stack-item-head">
                    <button type="button" className="notes-stack-item-title" onClick={(event) => {
                      event.stopPropagation();
                      focusNoteInStack(note.id);
                    }}>
                      {note.isPinned ? "📌 " : ""}
                      {note.title}
                    </button>
                    <div className="notes-stack-item-meta">
                      {project ? <span className="notes-stack-chip project">{project.name}</span> : null}
                      {subName ? <span className="notes-stack-chip">{subName}</span> : null}
                      <button type="button" className="btn btn-soft btn-compact" onClick={(event) => {
                        event.stopPropagation();
                        editNoteInStack(note.id);
                      }}>
                        편집
                      </button>
                    </div>
                  </header>
                  <div className="notes-stack-item-body">
                    <MarkdownRenderer
                      content={note.content}
                      emptyText="내용이 없습니다."
                      onChecklistToggle={(lineIndex, checked) => void toggleChecklistLine(note.id, lineIndex, checked)}
                    />
                  </div>
                </article>
              );
            })}
            {filteredNotes.length > stackLimit ? (
              <button type="button" className="btn btn-soft notes-stack-more" onClick={() => setStackLimit((limit) => limit + 20)}>
                노트 {filteredNotes.length - stackLimit}개 더 보기
              </button>
            ) : null}
          </div>
        ) : filterNode.kind !== "checklist" ? (
          <div className="notes-empty-detail">
            <p className="empty-text">노트를 선택하거나 새 노트를 만들어 시작하세요.</p>
            <button type="button" className="btn btn-primary notes-empty-action" onClick={() => void handleCreateNote()}>
              + 새 노트
            </button>
          </div>
        ) : null}
      </section>

      {metaModalOpen && draft ? (
        <NoteMetaModal
          draft={draft}
          projects={projects}
          subcategories={projectSubcategories}
          onApply={(patch) => void handleApplyMeta(patch)}
          onClose={() => setMetaModalOpen(false)}
        />
      ) : null}

      {actionItems ? (
        <NoteActionModal
          items={actionItems}
          isBusy={isCreatingActions}
          onConfirm={(actions) => void handleCreateActions(actions)}
          onClose={() => setActionItems(null)}
        />
      ) : null}

      {historyOpen && selectedNote ? (
        <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}>
          <div
            ref={historyDialogRef}
            className="modal-card note-history-modal"
            role="dialog"
            aria-modal="true"
            aria-label="노트 변경 이력"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <NoteHistoryPanel
              versions={selectedVersions}
              timeFormat={setting.timeFormat}
              onRestore={(versionId) => void handleRestoreVersion(versionId)}
              onCompare={(version) => {
                setCompareVersion(version);
                setHistoryOpen(false);
              }}
              onClose={() => setHistoryOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {aiMenu ? (
        <ContextMenu
          x={aiMenu.x}
          y={aiMenu.y}
          title="AI 편집"
          items={buildAiMenuItems()}
          onClose={() => setAiMenu(null)}
        />
      ) : null}

      {cardMenu ? (
        <ContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          title="노트"
          items={buildCardMenuItems(cardMenu.noteId)}
          onClose={() => setCardMenu(null)}
        />
      ) : null}
    </div>
  );
}
