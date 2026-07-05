import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { NoteCard } from "../components/NoteCard";
import { NoteConnections } from "../components/NoteConnections";
import { NoteEditor, type NoteEditorOverlay } from "../components/NoteEditor";
import { NoteHistoryPanel } from "../components/NoteHistoryPanel";
import { NoteMetaModal } from "../components/NoteMetaModal";
import { NoteActionModal, type ConfirmedAction } from "../components/NoteActionModal";
import { ProjectNoteTree, type NoteFilterNode } from "../components/ProjectNoteTree";
import { showToast } from "../components/ToastHost";
import { isAbortError } from "../agent/agentUtils";
import {
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
    removeNote,
    restoreNoteVersion,
    linkNoteToTask,
    unlinkNoteFromTask,
    createSubcategory,
  } = useAppData();

  const navigate = useNavigate();

  const [filterNode, setFilterNode] = useState<NoteFilterNode>({ kind: "all" });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteFormInput | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
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

  // 선택 노트가 바뀔 때만 draft 로드 (live query 지연 대응)
  useEffect(() => {
    if (!selectedNote) {
      loadedNoteIdRef.current = null;
      setDraft(null);
      return;
    }
    if (loadedNoteIdRef.current !== selectedNote.id) {
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
  }, [selectedNote]);

  useEffect(() => {
    if (selectedNoteId && !notes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(null);
    }
  }, [notes, selectedNoteId]);

  // 다른 탭(일정)에서 노트로 바로가기
  useEffect(() => {
    const handleFocusNote = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      if (detail?.noteId) {
        setSelectedNoteId(detail.noteId);
      }
    };
    window.addEventListener("ai-planner:focus-note", handleFocusNote);
    return () => window.removeEventListener("ai-planner:focus-note", handleFocusNote);
  }, []);

  // 백그라운드 자동화: 미선택 노트의 제목 자동 생성 + 세부항목 자동 분류
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const note of notes) {
          if (note.id === selectedNoteId) {
            continue;
          }
          const patch: Partial<NoteFormInput> = {};

          // 자동 제목: 기본 제목이고 본문이 있으면 첫 줄에서 파생
          if (isAutoTitle(note.title)) {
            const derived = deriveNoteTitle(note.content);
            if (derived && derived !== note.title) {
              patch.title = derived;
            }
          }

          const haystack = `${note.title} ${note.content}`.toLowerCase();

          // 자동 프로젝트 분류: 기본(일반) 프로젝트에 있는 노트에 다른 프로젝트명이 있으면 이동
          let effectiveProjectId = note.projectId;
          if (note.projectId === DEFAULT_PROJECT_ID) {
            const match = projects.find(
              (project) =>
                project.id !== DEFAULT_PROJECT_ID &&
                project.isActive &&
                project.name.trim().length >= 2 &&
                haystack.includes(project.name.toLowerCase()),
            );
            if (match) {
              patch.projectId = match.id;
              patch.subcategoryId = undefined;
              effectiveProjectId = match.id;
            }
          }

          // 자동 세부항목 분류: 미분류 + 세부항목명이 본문에 있으면 배정
          if (!note.subcategoryId && !patch.projectId) {
            const subs = projectSubcategories.filter((sub) => sub.projectId === effectiveProjectId && sub.name.trim());
            const match = subs.find((sub) => haystack.includes(sub.name.toLowerCase()));
            if (match) {
              patch.subcategoryId = match.id;
            }
          } else if (patch.projectId) {
            // 프로젝트가 바뀌면 새 프로젝트의 세부항목으로 다시 매칭
            const subs = projectSubcategories.filter((sub) => sub.projectId === effectiveProjectId && sub.name.trim());
            const match = subs.find((sub) => haystack.includes(sub.name.toLowerCase()));
            if (match) {
              patch.subcategoryId = match.id;
            }
          }

          if (Object.keys(patch).length > 0) {
            await updateNote(note.id, { ...noteToInput(note), ...patch });
          }
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [notes, projects, projectSubcategories, selectedNoteId, updateNote]);

  // 모든 노트의 미완료 체크리스트 항목 집계
  const openChecklistItems = useMemo(() => {
    const items: Array<{ noteId: string; noteTitle: string; projectColor: string; lineIndex: number; text: string }> = [];
    for (const note of notes) {
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
    const keyword = search.trim().toLowerCase();
    return notes
      .filter((note) => {
        switch (filterNode.kind) {
          case "all":
            break;
          case "pinned":
            if (!note.isPinned) return false;
            break;
          case "checklist":
            return false;
          case "project":
            if (note.projectId !== filterNode.projectId) return false;
            break;
          case "subcategory":
            if (note.subcategoryId !== filterNode.subcategoryId) return false;
            break;
          case "uncategorized":
            if (note.projectId !== filterNode.projectId || note.subcategoryId) return false;
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
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [notes, filterNode, search]);

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
    return (
      selectedNote.title !== draft.title ||
      selectedNote.content !== draft.content ||
      selectedNote.projectId !== draft.projectId ||
      (selectedNote.subcategoryId ?? "") !== (draft.subcategoryId ?? "") ||
      selectedNote.status !== draft.status ||
      selectedNote.isPinned !== draft.isPinned ||
      !tagsEqual(selectedNote.tags, draft.tags)
    );
  }, [selectedNote, draft]);

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
    setSelectedNoteId(id);
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
        setSelectedNoteId(id);
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
      { id: "open", label: "열기", onSelect: () => setSelectedNoteId(noteId) },
      { id: "summarize", label: "AI 요약", description: "요약 노트 생성", disabled: !hasApiConfig, onSelect: () => void handleSummarizeNote(noteId) },
      { id: "pin", label: note.isPinned ? "고정 해제" : "고정", onSelect: () => void updateNote(noteId, { ...noteToInput(note), isPinned: !note.isPinned }) },
    ];
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
    [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel, handleAiProgress, beginAiRequest],
  );

  const runInlineAssist = useCallback(async () => {
    if (!selectedNote || !draft) return;
    const { start, end } = selectionRef.current;
    if (start === end) {
      setAiError("먼저 편집할 텍스트를 선택해 주세요.");
      return;
    }
    const selectedText = draft.content.slice(start, end);
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
        activeNote: { id: selectedNote.id, title: draft.title, content: draft.content, projectId: draft.projectId },
        selectedText,
        notes,
        tasks,
        projects,
        taskTypes: [],
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      setAiProgress(result.trace ? `AI 참고: ${result.trace}` : "");
      if (result.replacementText) {
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
  }, [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel, handleAiProgress, beginAiRequest]);

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
      onSelect: () => navigate("/settings"),
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
        setSelectedNoteId(id);
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
        setSelectedNoteId(id);
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
      case "project":
        return projectMap[filterNode.projectId]?.name ?? "프로젝트";
      case "subcategory":
        return subMap[filterNode.subcategoryId]?.name ?? "세부 항목";
      case "uncategorized":
        return `${projectMap[filterNode.projectId]?.name ?? "프로젝트"} · 미분류`;
    }
  }, [filterNode, projectMap, subMap]);

  return (
    <div className="notes-workspace">
      {/* 탐색기: 검색·트리·목록을 한 컬럼으로 — 편집기에 나머지 공간을 몰아준다 */}
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
                    onClick={() => setSelectedNoteId(item.noteId)}
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
              <p className="empty-text">노트가 없습니다. "새 노트"로 시작하세요.</p>
            ) : (
              filteredNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  project={projectMap[note.projectId]}
                  isSelected={note.id === selectedNoteId}
                  isChecked={checkedIds.has(note.id)}
                  linkedTaskCount={note.linkedTaskIds.length}
                  onSelect={() => setSelectedNoteId(note.id)}
                  onToggleCheck={(checked) => toggleCheck(note.id, checked)}
                  onOpenMenu={(pos) => setCardMenu({ x: pos.x, y: pos.y, noteId: note.id })}
                />
              ))
            )}
          </div>
        )}
        </div>
      </aside>

      <main className="notes-detail-pane">
        {selectedNote && draft && currentProject ? (
          <>
            <NoteEditor
              key={selectedNote.id}
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
                  if (!prev) {
                    return prev;
                  }
                  // 제목이 아직 자동 상태면 본문 첫 줄에서 제목을 따라 갱신한다.
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
              onOpenNote={(noteId) => setSelectedNoteId(noteId)}
              onLink={(taskId) => void linkNoteToTask(selectedNote.id, taskId, "auto_suggest")}
              onUnlink={(taskId) => void unlinkNoteFromTask(selectedNote.id, taskId)}
              isBusy={isSaving}
            />
          </>
        ) : (
          <div className="notes-empty-detail">
            <p className="empty-text">노트를 선택하거나 새 노트를 만들어 시작하세요.</p>
          </div>
        )}
      </main>

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
          <div className="modal-card note-history-modal" onClick={(event) => event.stopPropagation()}>
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
