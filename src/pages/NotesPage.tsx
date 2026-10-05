import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "../routing";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { ModalBackdrop } from "../components/ModalBackdrop";
import { NoteCard } from "../components/NoteCard";
import { NoteConnections } from "../components/NoteConnections";
import { NoteEditor, type NoteEditorOverlay } from "../components/NoteEditor";
import { NoteHistoryPanel } from "../components/NoteHistoryPanel";
import { NoteMetaModal } from "../components/NoteMetaModal";
import { NoteActionModal, type ConfirmedAction } from "../components/NoteActionModal";
import { ProjectNoteTree, type NoteFilterNode } from "../components/ProjectNoteTree";
import { showToast } from "../utils/toast";
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
import { downloadNoteMarkdown, downloadNotesArchive } from "../utils/noteMarkdownExport";
import { readNoteChecklist, setNoteChecklistItem } from "../utils/noteChecklist";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { NoteTaskLinkModal } from "../components/NoteTaskLinkModal";

interface AiProposal {
  noteId: string;
  baseRevision: number;
  baseContent: string;
  content: string;
  title?: string;
  editType: NoteVersionEditType;
  prompt: string;
  headline: string;
}

interface BulkAiProposal {
  input: NoteFormInput;
  sourceIds: string[];
  sourceRevisions: Record<string, string>;
  mode: "summarize" | "merge";
}

const NOTE_AUTOSAVE_IDLE_MS = 2_000;
// Keep failed/in-flight drafts through SPA navigation; they never leave this browser tab.
const recoverableDrafts = new Map<string, { draft: NoteFormInput; base: NoteFormInput; revision: string; error?: string }>();
let sharedNoteSaveQueue: Promise<void> = Promise.resolve();
const sharedNoteRevisions = new Map<string, string>();
const sharedSavedDrafts = new Map<string, NoteFormInput>();

function bulkPreviewBody(input: NoteFormInput): string {
  const heading = input.content.match(/^\s*#\s+([^\r\n]+)\r?\n/);
  return heading?.[1].trim() === input.title.trim() ? input.content.slice(heading[0].length) : input.content;
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
    sourceNoteIds: note.sourceNoteIds,
  };
}

function normalizeNoteDraftSnapshot(input: NoteFormInput): NoteFormInput {
  return {
    ...input,
    title: input.title.trim() || "제목 없는 노트",
    tags: Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))),
    sourceNoteIds: Array.from(new Set(input.sourceNoteIds ?? [])),
  };
}

function tagsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}

function draftsEqual(a: NoteFormInput, b: NoteFormInput): boolean {
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.projectId === b.projectId &&
    (a.subcategoryId ?? "") === (b.subcategoryId ?? "") &&
    a.status === b.status &&
    a.isPinned === b.isPinned &&
    tagsEqual(a.tags, b.tags) &&
    tagsEqual(a.sourceNoteIds ?? [], b.sourceNoteIds ?? [])
  );
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
    createMergedNote,
    createTasksForNote,
    updateNote,
    updateNoteTitleIfUnchanged,
    applyNoteAiClassification,
    removeNote,
    restoreNoteVersion,
    linkNoteToTask,
    unlinkNoteFromTask,
    createSubcategory,
    reorderNotes,
  } = useAppData();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filterNode, setFilterNode] = useState<NoteFilterNode>({ kind: "all" });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteFormInput | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [search, setSearch] = useState("");
  // 타이핑 중 전체 노트 스캔이 입력을 막지 않도록 검색어 반영을 지연시킨다
  const deferredSearch = useDeferredValue(search);
  // 노트가 수백 개여도 DOM이 무거워지지 않게 목록을 점진적으로 렌더링한다
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [isMobileExplorerOpen, setIsMobileExplorerOpen] = useState(false);
  const [noteConflict, setNoteConflict] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [exportMenu, setExportMenu] = useState<{ x: number; y: number } | null>(null);
  const [actionError, setActionError] = useState("");
  const [bulkProposal, setBulkProposal] = useState<BulkAiProposal | null>(null);
  const [isApplyingBulk, setIsApplyingBulk] = useState(false);
  const [taskLinkOpen, setTaskLinkOpen] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [isExportingNotes, setIsExportingNotes] = useState(false);
  const [pendingEditNoteId, setPendingEditNoteId] = useState<string | null>(null);
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
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number; align?: "start" | "end"; anchored?: boolean } | null>(
    null,
  );
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number; align?: "start" | "end"; anchored?: boolean } | null>(
    null,
  );
  const [cardMenu, setCardMenu] = useState<{ x: number; y: number; noteId: string } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sourceLinkFocusRef = useRef<string | null>(null);
  const loadedNoteIdRef = useRef<string | null>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const abortRef = useRef<AbortController | null>(null);
  // 노트 전환/페이지 이탈 시점에 미저장 수정분을 플러시하기 위한 최신 상태 미러
  const draftRef = useRef<NoteFormInput | null>(null);
  const draftRevisionRef = useRef(0);
  const notesRef = useRef<Note[]>(notes);
  const idleAutosaveTimerRef = useRef<number | null>(null);
  const classificationInFlightRef = useRef(false);
  const classificationAttemptedRef = useRef(new Set<string>());
  const noteSaveQueueRef = useRef<Promise<void>>(sharedNoteSaveQueue);
  const savingCountRef = useRef(0);
  const noteRevisionsRef = useRef(sharedNoteRevisions);
  const savedDraftsRef = useRef(sharedSavedDrafts);
  const conflictDraftsRef = useRef(new Map<string, NoteFormInput>());
  const pendingSavesRef = useRef(new Map<string, number>());
  const queuedDraftsRef = useRef(new Map<string, NoteFormInput>());
  const checklistBusyRef = useRef(new Set<string>());
  const priorListRef = useRef<{ filter: NoteFilterNode; search: string } | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const commitDraft = useCallback((nextDraft: NoteFormInput | null) => {
    draftRef.current = nextDraft;
    draftRevisionRef.current += 1;
    setDraft(nextDraft);
    const id = loadedNoteIdRef.current;
    const base = id ? savedDraftsRef.current.get(id) : undefined;
    const revision = id ? noteRevisionsRef.current.get(id) : undefined;
    if (id && nextDraft && base && revision) {
      const recovery = recoverableDrafts.get(id);
      if (draftsEqual(nextDraft, base) && !(pendingSavesRef.current.get(id) ?? 0) && !conflictDraftsRef.current.has(id)) {
        recoverableDrafts.delete(id);
      } else {
        recoverableDrafts.set(id, { draft: nextDraft, base, revision, error: recovery?.error });
        if (conflictDraftsRef.current.has(id)) conflictDraftsRef.current.set(id, nextDraft);
      }
    }
  }, []);

  const beginSaving = useCallback(() => {
    savingCountRef.current += 1;
    setIsSaving(true);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      savingCountRef.current = Math.max(0, savingCountRef.current - 1);
      setIsSaving(savingCountRef.current > 0);
    };
  }, []);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const clearIdleAutosaveTimer = useCallback(() => {
    if (idleAutosaveTimerRef.current !== null) {
      window.clearTimeout(idleAutosaveTimerRef.current);
      idleAutosaveTimerRef.current = null;
    }
  }, []);

  const enqueueNoteUpdate = useCallback(
    (id: string, input: NoteFormInput | ((previous: NoteFormInput) => NoteFormInput), editType: NoteVersionEditType = "manual", aiPrompt?: string) => {
      const note = notesRef.current.find((item) => item.id === id);
      const queued = pendingSavesRef.current.get(id) ?? 0;
      if (note && (!noteRevisionsRef.current.has(id) || (queued === 0 && loadedNoteIdRef.current !== id && !conflictDraftsRef.current.has(id) && new Date(note.updatedAt).getTime() >= new Date(noteRevisionsRef.current.get(id) ?? "").getTime()))) {
        noteRevisionsRef.current.set(id, note.updatedAt);
        savedDraftsRef.current.set(id, noteToInput(note));
      }
      pendingSavesRef.current.set(id, queued + 1);
      if (typeof input !== "function") queuedDraftsRef.current.set(id, normalizeNoteDraftSnapshot(input));
      const pending = sharedNoteSaveQueue
        .catch(() => undefined)
        .then(async () => {
          const recovery = recoverableDrafts.get(id);
          if (recovery && !recovery.error && new Date(recovery.revision).getTime() > new Date(noteRevisionsRef.current.get(id) ?? "").getTime()) {
            noteRevisionsRef.current.set(id, recovery.revision);
            savedDraftsRef.current.set(id, recovery.base);
          }
          const previous = savedDraftsRef.current.get(id);
          if (!previous) throw new Error("저장할 노트를 찾을 수 없습니다.");
          const snapshot = normalizeNoteDraftSnapshot(typeof input === "function" ? input(previous) : input);
          try {
            const updatedAt = await updateNote(id, snapshot, editType, aiPrompt, noteRevisionsRef.current.get(id));
            if (updatedAt) {
              noteRevisionsRef.current.set(id, updatedAt);
              savedDraftsRef.current.set(id, snapshot);
              conflictDraftsRef.current.delete(id);
              const recovery = recoverableDrafts.get(id);
              if (recovery) {
                if (draftsEqual(recovery.draft, snapshot)) recoverableDrafts.delete(id);
                else recoverableDrafts.set(id, { draft: recovery.draft, base: snapshot, revision: updatedAt });
              }
            }
            return updatedAt;
          } catch (error) {
            const recovery = recoverableDrafts.get(id);
            recoverableDrafts.set(id, { draft: recovery?.draft ?? snapshot, base: previous, revision: noteRevisionsRef.current.get(id) ?? note?.updatedAt ?? "", error: error instanceof Error ? error.message : "저장 실패" });
            if (error instanceof Error && error.message.includes("다른 작업")) {
              conflictDraftsRef.current.set(id, snapshot);
              if (loadedNoteIdRef.current === id) setNoteConflict(true);
            }
            throw error;
          }
        })
        .finally(() => {
          const remaining = Math.max(0, (pendingSavesRef.current.get(id) ?? 1) - 1);
          pendingSavesRef.current.set(id, remaining);
          if (!remaining) queuedDraftsRef.current.delete(id);
        });
      noteSaveQueueRef.current = pending.then(() => undefined, () => undefined);
      sharedNoteSaveQueue = noteSaveQueueRef.current;
      return pending;
    },
    [updateNote],
  );

  // 미저장 수정분이 있으면 조용히 자동 저장한다 (전환·이탈로 인한 유실 방지)
  const flushPendingDraft = useCallback(() => {
    clearIdleAutosaveTimer();
    const pendingId = loadedNoteIdRef.current;
    const pendingDraft = draftRef.current;
    if (!pendingId || !pendingDraft) {
      return;
    }
    const pendingNote = notesRef.current.find((note) => note.id === pendingId);
    const queuedDraft = queuedDraftsRef.current.get(pendingId);
    const differsFromQueued = !!queuedDraft && (pendingSavesRef.current.get(pendingId) ?? 0) > 0 && !draftsEqual(queuedDraft, pendingDraft);
    if (pendingNote && (isDraftDifferentFromNote(pendingNote, pendingDraft) || differsFromQueued)) {
      void enqueueNoteUpdate(pendingId, normalizeNoteDraftSnapshot(pendingDraft), "autosave").catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : "노트를 저장하지 못했습니다.", { tone: "error" });
      });
    }
  }, [clearIdleAutosaveTimer, enqueueNoteUpdate]);

  // 노트 탭을 떠날 때(언마운트) 마지막 수정분 저장
  useEffect(() => {
    return () => {
      flushPendingDraft();
    };
  }, [flushPendingDraft]);

  useEffect(() => {
    const handlePageHide = () => flushPendingDraft();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingDraft();
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
    onClose: () => { if (!isRestoring) setHistoryOpen(false); },
  });
  const explorerDialogRef = useDialogFocus<HTMLElement>({
    isOpen: isMobileExplorerOpen,
    onClose: () => setIsMobileExplorerOpen(false),
  });
  const bulkDialogRef = useDialogFocus<HTMLElement>({
    isOpen: Boolean(bulkProposal),
    onClose: closeBulkProposal,
  });

  // createNote 직후에는 live query가 아직 새 노트를 반영하지 않았을 수 있다.
  // 실제 목록에 나타난 시점에 선택해야 존재하지 않는 선택으로 정리되는 경쟁 조건을 피할 수 있다.
  useEffect(() => {
    if (!pendingEditNoteId || !notes.some((note) => note.id === pendingEditNoteId)) {
      return;
    }
    setSelectedNoteId(pendingEditNoteId);
    setPendingEditNoteId(null);
  }, [notes, pendingEditNoteId]);

  // 선택 노트가 바뀔 때만 draft 로드 (live query 지연 대응)
  useEffect(() => {
    if (!selectedNote) {
      // 선택 해제 시에도 미저장분이 있으면 저장 (삭제된 노트는 flush 내부에서 걸러진다)
      flushPendingDraft();
      loadedNoteIdRef.current = null;
      commitDraft(null);
      setNoteConflict(false);
      selectionRef.current = { start: 0, end: 0 };
      return;
    }
    if (loadedNoteIdRef.current !== selectedNote.id) {
      // 다른 노트로 전환: 이전 노트의 수정분을 먼저 자동 저장해 유실을 막는다
      flushPendingDraft();
      abortRef.current?.abort();
      loadedNoteIdRef.current = selectedNote.id;
      const recovery = recoverableDrafts.get(selectedNote.id);
      const savedAheadOfQuery = new Date(noteRevisionsRef.current.get(selectedNote.id) ?? "").getTime() > new Date(selectedNote.updatedAt).getTime() ? savedDraftsRef.current.get(selectedNote.id) : undefined;
      const recoveredDraft = recovery?.draft ?? conflictDraftsRef.current.get(selectedNote.id) ?? queuedDraftsRef.current.get(selectedNote.id) ?? savedAheadOfQuery;
      if (recovery) {
        noteRevisionsRef.current.set(selectedNote.id, recovery.revision);
        savedDraftsRef.current.set(selectedNote.id, recovery.base);
      } else if (!recoveredDraft && !(pendingSavesRef.current.get(selectedNote.id) ?? 0)) {
        noteRevisionsRef.current.set(selectedNote.id, selectedNote.updatedAt);
        savedDraftsRef.current.set(selectedNote.id, noteToInput(selectedNote));
      }
      commitDraft(recoveredDraft ?? noteToInput(selectedNote));
      setNoteConflict(Boolean(recovery?.error || conflictDraftsRef.current.has(selectedNote.id)));
      selectionRef.current = { start: 0, end: 0 };
      setIsAiRunning(false);
      setAiProposal(null);
      setCompareVersion(null);
      setMetaModalOpen(false);
      setHistoryOpen(false);
      setSavedMessage("");
      setErrorMessage("");
      setAiError("");
      setAiProgress("");
      setActionItems(null);
      setActionError("");
      setTaskLinkOpen(false);
    } else if (new Date(selectedNote.updatedAt).getTime() > new Date(noteRevisionsRef.current.get(selectedNote.id) ?? "").getTime() && !(pendingSavesRef.current.get(selectedNote.id) ?? 0)) {
      const currentDraft = draftRef.current;
      const savedDraft = savedDraftsRef.current.get(selectedNote.id);
      const incoming = noteToInput(selectedNote);
      const recovery = recoverableDrafts.get(selectedNote.id);
      if (currentDraft && draftsEqual(currentDraft, incoming)) {
        noteRevisionsRef.current.set(selectedNote.id, selectedNote.updatedAt);
        savedDraftsRef.current.set(selectedNote.id, incoming);
        recoverableDrafts.delete(selectedNote.id);
        conflictDraftsRef.current.delete(selectedNote.id);
        setNoteConflict(false);
      } else if (currentDraft && recovery?.revision === selectedNote.updatedAt && draftsEqual(incoming, recovery.base)) {
        // A save started before SPA navigation may finish after this instance mounts.
        noteRevisionsRef.current.set(selectedNote.id, selectedNote.updatedAt);
        savedDraftsRef.current.set(selectedNote.id, incoming);
        recoverableDrafts.set(selectedNote.id, { draft: currentDraft, base: incoming, revision: selectedNote.updatedAt });
        conflictDraftsRef.current.delete(selectedNote.id);
        setNoteConflict(false);
      } else if (savedDraft && draftsEqual(incoming, savedDraft)) {
        // Linking a task changes the record revision but no editable fields.
        noteRevisionsRef.current.set(selectedNote.id, selectedNote.updatedAt);
        if (recovery) recoverableDrafts.set(selectedNote.id, { ...recovery, revision: selectedNote.updatedAt });
      } else if (currentDraft && savedDraft && draftsEqual(currentDraft, savedDraft)) {
        noteRevisionsRef.current.set(selectedNote.id, selectedNote.updatedAt);
        savedDraftsRef.current.set(selectedNote.id, noteToInput(selectedNote));
        commitDraft(noteToInput(selectedNote));
        recoverableDrafts.delete(selectedNote.id);
        setNoteConflict(false);
      } else if (currentDraft) {
        conflictDraftsRef.current.set(selectedNote.id, currentDraft);
        recoverableDrafts.set(selectedNote.id, { draft: currentDraft, base: savedDraft ?? incoming, revision: noteRevisionsRef.current.get(selectedNote.id) ?? selectedNote.updatedAt, error: "다른 작업에서 노트가 변경되었습니다." });
        setNoteConflict(true);
      }
    }
  }, [selectedNote, flushPendingDraft, commitDraft, isSaving]);

  useEffect(() => {
    const existing = new Set(notes.map((note) => note.id));
    setCheckedIds((previous) => {
      const next = new Set([...previous].filter((id) => existing.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [notes]);

  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      const id = loadedNoteIdRef.current;
      const note = notesRef.current.find((item) => item.id === id);
      if (note && draftRef.current && isDraftDifferentFromNote(note, draftRef.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warnUnsaved);
    return () => window.removeEventListener("beforeunload", warnUnsaved);
  }, []);

  useEffect(() => {
    if (selectedNoteId && !notes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(null);
    }
  }, [notes, selectedNoteId]);

  useEffect(() => {
    if (!selectedNoteId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedNoteId]);

  // 검색 결과의 실제 노트 링크를 현재 필터와 무관하게 연다.
  useEffect(() => {
    const noteId = searchParams.get("noteId");
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    // Clear both the immediate and deferred filter before selecting a linked note.
    // Otherwise the existing search-selection guard can immediately deselect it.
    if (search) setSearch("");
    if (deferredSearch.trim()) return;
    setFilterNode({ kind: note.status === "archived" ? "archived" : "all" });
    sourceLinkFocusRef.current = note.id;
    setSelectedNoteId(note.id);
    setIsMobileExplorerOpen(false);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("noteId");
    setSearchParams(nextParams, { replace: true });
  }, [notes, search, deferredSearch, searchParams, setSearchParams]);

  useEffect(() => {
    if (!selectedNoteId || !draft || sourceLinkFocusRef.current !== selectedNoteId) return;
    const frame = window.requestAnimationFrame(() => {
      const titleInput = document.querySelector<HTMLInputElement>(".note-title-input");
      if (titleInput) {
        titleInput.focus({ preventScroll: true });
        sourceLinkFocusRef.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedNoteId, draft, searchParams]);

  // 다른 탭(일정)에서 노트로 바로가기
  useEffect(() => {
    const handleFocusNote = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId?: string }>).detail;
      if (detail?.noteId) {
        const note = notesRef.current.find((item) => item.id === detail.noteId);
        setSearch("");
        setFilterNode({ kind: note?.status === "archived" ? "archived" : "all" });
        setPendingEditNoteId(detail.noteId);
        setIsMobileExplorerOpen(false);
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
              await updateNoteTitleIfUnchanged(note.id, derived, note.updatedAt);
            }
          }
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [notes, selectedNoteId, updateNoteTitleIfUnchanged]);

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
      readNoteChecklist(note.content).forEach((item) => {
        if (!item.checked) {
          items.push({
            noteId: note.id,
            noteTitle: note.title,
            projectColor: projectMap[note.projectId]?.color ?? "var(--body-muted)",
            lineIndex: item.lineIndex,
            text: item.text,
          });
        }
      });
    }
    return items;
  }, [notes, projectMap]);

  const filteredChecklistItems = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase();
    if (!keyword) return openChecklistItems;
    return openChecklistItems.filter((item) => {
      const note = notes.find((candidate) => candidate.id === item.noteId);
      return `${item.text} ${item.noteTitle} ${note?.tags.join(" ") ?? ""}`.toLowerCase().includes(keyword);
    });
  }, [openChecklistItems, notes, deferredSearch]);

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

  function openNote(noteId: string, reveal = false) {
    if (isRestoring) return;
    const note = notesRef.current.find((item) => item.id === noteId);
    if (!note) {
      setSearch("");
      setFilterNode({ kind: "all" });
      setPendingEditNoteId(noteId);
      return;
    }
    if (reveal) {
      if (!priorListRef.current) priorListRef.current = { filter: filterNode, search };
      setSearch("");
      setFilterNode({ kind: note.status === "archived" ? "archived" : "all" });
    }
    setSelectedNoteId(noteId);
    setIsMobileExplorerOpen(false);
  }

  function handleDraftTitleChange(value: string) {
    const current = draftRef.current;
    if (!current || current.title === value) return;
    commitDraft({ ...current, title: value });
  }

  function handleDraftContentChange(value: string) {
    const current = draftRef.current;
    if (!current || current.content === value) return;
    const following = isFollowingTitle(current.title, current.content);
    const nextTitle = following ? deriveNoteTitle(value) || "새 노트" : current.title;
    commitDraft({ ...current, content: value, title: nextTitle });
  }

  // 탐색기 카드 드래그로 순서 변경 — 검색 중에는 부분 목록이라 비활성화
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [dragOverNoteId, setDragOverNoteId] = useState<string | null>(null);
  const isNoteDragEnabled = !search.trim() && filterNode.kind !== "checklist" && !selectionMode;

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
    if (filteredNotes[fromIndex].isPinned !== filteredNotes[toIndex].isPinned) return;
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    void reorderNotes(ids).catch((error: unknown) => showToast(error instanceof Error ? error.message : "순서를 변경하지 못했습니다.", { tone: "error" }));
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
    if (filteredNotes[fromIndex].isPinned !== filteredNotes[toIndex].isPinned) return;
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, noteId);
    void reorderNotes(ids).catch((error: unknown) => showToast(error instanceof Error ? error.message : "순서를 변경하지 못했습니다.", { tone: "error" }));
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
    if (!selectedNote || !setting.noteTaskSuggestionsEnabled) return [];
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
  }, [selectedNote, setting.noteTaskSuggestionsEnabled, tasks, taskMap]);

  const relatedNotes = useMemo(() => {
    if (!selectedNote) return [];
    const noteMap = Object.fromEntries(notes.map((note) => [note.id, note]));
    const originalIds = new Set(selectedNote.sourceNoteIds ?? []);
    const originals = (selectedNote.sourceNoteIds ?? [])
      .map((noteId) => noteMap[noteId])
      .filter((note): note is Note => Boolean(note))
      .map((note) => ({ note, reason: "통합 원본 노트", isOriginal: true }));
    if (!setting.relatedNoteSuggestionsEnabled) return originals;

    const suggestions = suggestRelatedNotes({ note: selectedNote, notes, limit: 5 })
      .filter((item) => !originalIds.has(item.noteId))
      .map((item) => ({ note: noteMap[item.noteId], reason: item.reason, isOriginal: false }))
      .filter((item): item is { note: Note; reason: string; isOriginal: false } => Boolean(item.note));
    return [...originals, ...suggestions];
  }, [selectedNote, setting.relatedNoteSuggestionsEnabled, notes]);

  const isDirty = useMemo(() => {
    if (!selectedNote || !draft) return false;
    return isDraftDifferentFromNote(selectedNote, draft);
  }, [selectedNote, draft]);

  // 마지막 입력 후 2초 동안 추가 수정이 없을 때 한 번만 자동 저장한다.
  useEffect(() => {
    clearIdleAutosaveTimer();
    if (!selectedNoteId || !draft || !isDirty || noteConflict || isRestoring) {
      return;
    }

    const noteId = selectedNoteId;
    idleAutosaveTimerRef.current = window.setTimeout(() => {
      idleAutosaveTimerRef.current = null;
      const latestDraft = draftRef.current;
      const latestNote = notesRef.current.find((note) => note.id === noteId);
      if (loadedNoteIdRef.current !== noteId || !latestDraft || !latestNote || !isDraftDifferentFromNote(latestNote, latestDraft)) {
        return;
      }

      const snapshot = normalizeNoteDraftSnapshot(latestDraft);
      if (!draftsEqual(snapshot, latestDraft)) commitDraft(snapshot);
      const finishSaving = beginSaving();
      setErrorMessage("");
      void enqueueNoteUpdate(noteId, snapshot, "autosave")
        .then(() => {
          setSavedMessage("자동 저장했습니다.");
          window.setTimeout(() => setSavedMessage(""), 2000);
        })
        .catch((error: unknown) => {
          setErrorMessage(error instanceof Error ? error.message : "자동 저장에 실패했습니다.");
        })
        .finally(() => {
          finishSaving();
        });
    }, NOTE_AUTOSAVE_IDLE_MS);

    return clearIdleAutosaveTimer;
  }, [beginSaving, clearIdleAutosaveTimer, commitDraft, draft, enqueueNoteUpdate, isDirty, selectedNoteId, noteConflict, isRestoring]);

  const currentSubcategoryName = draft?.subcategoryId ? subMap[draft.subcategoryId]?.name : undefined;
  const currentProject = draft ? projectMap[draft.projectId] : undefined;

  const editorOverlay: NoteEditorOverlay | null = useMemo(() => {
    if (!selectedNote) return null;
    if (aiProposal) {
      return {
        previous: aiProposal.baseContent,
        next: aiProposal.content,
        headline: aiProposal.headline,
        mode: "proposal",
        isApplying: isSaving,
      };
    }
    if (compareVersion) {
      return {
        previous: compareVersion.content,
        next: draft?.content ?? selectedNote.content,
        headline: "선택 버전 → 현재",
        mode: "compare",
      };
    }
    return null;
  }, [selectedNote, draft, aiProposal, compareVersion, isSaving]);

  const handleCreateNote = useCallback(async () => {
    if (isCreatingNote) return;
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
    setIsCreatingNote(true);
    setErrorMessage("");
    try {
      const id = await createNote(base);
      setSearch("");
      if (filterNode.kind === "archived" || filterNode.kind === "pinned" || filterNode.kind === "checklist") {
        setFilterNode({ kind: "all" });
      }
      setPendingEditNoteId(id);
      setIsMobileExplorerOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "노트를 만들지 못했습니다.");
      showToast("노트를 만들지 못했습니다.");
    } finally {
      setIsCreatingNote(false);
    }
  }, [activeProjectId, createNote, filterNode, isCreatingNote]);

  useEffect(() => {
    const handleCreateRequest = () => void handleCreateNote();
    window.addEventListener("ai-planner:create-note", handleCreateRequest);
    return () => window.removeEventListener("ai-planner:create-note", handleCreateRequest);
  }, [handleCreateNote]);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  async function handleSave(editType: NoteVersionEditType = "manual") {
    if (!selectedNoteId || !draft) return;
    clearIdleAutosaveTimer();
    const snapshot = normalizeNoteDraftSnapshot(draft);
    if (!draftsEqual(snapshot, draft)) commitDraft(snapshot);
    const finishSaving = beginSaving();
    setErrorMessage("");
    try {
      await enqueueNoteUpdate(selectedNoteId, snapshot, editType);
      setSavedMessage("저장했습니다.");
      window.setTimeout(() => setSavedMessage(""), 2000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      finishSaving();
    }
  }

  async function handleApplyMeta(patch: Partial<NoteFormInput>) {
    if (!selectedNoteId || !draft) throw new Error("수정할 노트를 찾을 수 없습니다.");
    clearIdleAutosaveTimer();
    const nextInput = normalizeNoteDraftSnapshot({ ...draft, ...patch });
    const revision = draftRevisionRef.current;
    const id = selectedNoteId;
    await enqueueNoteUpdate(id, nextInput);
    if (loadedNoteIdRef.current === id && draftRevisionRef.current === revision) commitDraft(nextInput);
  }

  async function handleDelete() {
    if (!selectedNoteId) return;
    await handleDeleteNote(selectedNoteId);
  }

  // 체크박스 토글 → 해당 노트 본문 반영 + 저장 (선택 노트/집계 뷰 공용)
  async function toggleChecklistLine(noteId: string, lineIndex: number, checked: boolean) {
    const key = `${noteId}:${lineIndex}`;
    if (checklistBusyRef.current.has(key)) return;
    checklistBusyRef.current.add(key);
    try {
      await enqueueNoteUpdate(noteId, (previous) => ({ ...previous, content: setNoteChecklistItem(previous.content, lineIndex, checked) }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "체크리스트를 저장하지 못했습니다.", { tone: "error" });
    } finally {
      checklistBusyRef.current.delete(key);
    }
  }

  async function updateNoteMetadata(noteId: string, patch: Partial<NoteFormInput>) {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return;
    const previousInput = noteId === selectedNoteId && draft ? draft : noteToInput(note);
    const nextInput = { ...previousInput, ...patch };
    const isSelected = noteId === selectedNoteId;

    if (isSelected) {
      clearIdleAutosaveTimer();
      // 선택 노트의 메타데이터와 편집 초안을 동시에 맞춰, 이전 초안이
      // 자동 저장되면서 방금 적용한 고정·상태 값을 되돌리지 않게 한다.
      commitDraft(nextInput);
    }

    try {
      await enqueueNoteUpdate(noteId, nextInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : "노트 정보를 변경하지 못했습니다.";
      setErrorMessage(message);
      showToast(message);
    }
  }

  async function setNoteStatus(noteId: string, status: NoteStatus) {
    await updateNoteMetadata(noteId, { status });
  }

  async function handleDeleteNote(noteId: string) {
    if (!window.confirm("이 노트를 삭제할까요? 되돌릴 수 없습니다.")) return;
    if (loadedNoteIdRef.current === noteId) {
      clearIdleAutosaveTimer();
      abortRef.current?.abort();
    }
    try {
      await noteSaveQueueRef.current;
      await removeNote(noteId);
      recoverableDrafts.delete(noteId);
      conflictDraftsRef.current.delete(noteId);
      savedDraftsRef.current.delete(noteId);
      noteRevisionsRef.current.delete(noteId);
      if (selectedNoteId === noteId) setSelectedNoteId(null);
      setCheckedIds((previous) => { const next = new Set(previous); next.delete(noteId); return next; });
      showToast("노트를 삭제했습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "노트를 삭제하지 못했습니다.", { tone: "error" });
    }
  }

  async function handleSummarizeNote(noteId: string) {
    const storedNote = notes.find((item) => item.id === noteId);
    const note = storedNote ? noteWithCurrentDraft(storedNote) : undefined;
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
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (result.proposedContent) {
        if (controller.signal.aborted) return;
        setBulkProposal({
          input: {
            title: result.proposedTitle?.trim() || `요약: ${note.title}`,
            content: result.proposedContent,
            projectId: note.projectId,
            subcategoryId: note.subcategoryId,
            tags: ["요약"],
            status: "active",
            isPinned: false,
          },
          mode: "summarize", sourceIds: [note.id], sourceRevisions: {},
        });
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

  function noteWithCurrentDraft(note: Note): Note {
    const currentDraft = draftRef.current;
    if (loadedNoteIdRef.current !== note.id || !currentDraft) return note;
    const snapshot = normalizeNoteDraftSnapshot(currentDraft);
    return {
      ...note,
      ...snapshot,
      updatedAt: isDraftDifferentFromNote(note, snapshot) ? new Date().toISOString() : note.updatedAt,
    };
  }

  function handleDownloadNote(noteId: string) {
    const note = notes.find((item) => item.id === noteId);
    if (!note) {
      showToast("다운로드할 노트를 찾지 못했습니다.", { tone: "error" });
      return;
    }
    try {
      const exportNote = noteWithCurrentDraft(note);
      const subproject = exportNote.subcategoryId ? subMap[exportNote.subcategoryId] : undefined;
      const fileName = downloadNoteMarkdown(exportNote, projectMap[exportNote.projectId], subproject);
      showToast(`${fileName} 다운로드를 시작했습니다.`, { tone: "success" });
    } catch (downloadError) {
      showToast(downloadError instanceof Error ? downloadError.message : "노트를 다운로드하지 못했습니다.", { tone: "error" });
    }
  }

  async function handleExportNotes(scope: "all" | "visible" | "selected") {
    if (isExportingNotes) return;
    setIsExportingNotes(true);
    try {
      const targets = scope === "selected" ? notes.filter((note) => checkedIds.has(note.id)) : scope === "visible" ? filteredNotes : notes;
      if (!targets.length) throw new Error("내보낼 노트가 없습니다.");
      const result = await downloadNotesArchive(targets.map(noteWithCurrentDraft), projects, projectSubcategories);
      showToast(`노트 ${result.fileCount}개를 ZIP 파일로 내보냈습니다.`, { tone: "success" });
    } catch (exportError) {
      showToast(exportError instanceof Error ? exportError.message : "노트를 내보내지 못했습니다.", { tone: "error" });
    } finally {
      setIsExportingNotes(false);
    }
  }

  function buildCardMenuItems(noteId: string): ContextMenuItem[] {
    const note = notes.find((item) => item.id === noteId);
    if (!note) return [];
    const items: ContextMenuItem[] = [
      { id: "summarize", label: "AI 요약", description: "요약 노트 생성", disabled: !hasApiConfig, onSelect: () => void handleSummarizeNote(noteId) },
      {
        id: "pin",
        label: note.isPinned ? "고정 해제" : "고정",
        onSelect: () => void updateNoteMetadata(noteId, { isPinned: !note.isPinned }),
      },
      {
        id: "download-markdown",
        label: "Markdown 다운로드",
        description: "프론트매터와 본문 내보내기",
        onSelect: () => handleDownloadNote(noteId),
      },
    ];
    const noteIndex = filteredNotes.findIndex((item) => item.id === noteId);
    if (isNoteDragEnabled && noteIndex >= 0) {
      items.push(
        {
          id: "move-up",
          label: "위로 이동",
          description: "노트 순서를 한 칸 위로 이동",
          disabled: noteIndex === 0 || filteredNotes[noteIndex - 1]?.isPinned !== note.isPinned,
          onSelect: () => moveNoteByOffset(noteId, -1),
        },
        {
          id: "move-down",
          label: "아래로 이동",
          description: "노트 순서를 한 칸 아래로 이동",
          disabled: noteIndex === filteredNotes.length - 1 || filteredNotes[noteIndex + 1]?.isPinned !== note.isPinned,
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
      const noteIdAtRequest = selectedNote.id;
      const revisionAtRequest = draftRevisionRef.current;
      const contentAtRequest = draft.content;
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
          onProgress: handleAiProgress,
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          loadedNoteIdRef.current !== noteIdAtRequest ||
          draftRevisionRef.current !== revisionAtRequest
        ) {
          if (loadedNoteIdRef.current === noteIdAtRequest) {
            setAiError("AI 처리 중 노트가 변경되어 제안을 적용하지 않았습니다. 다시 요청해 주세요.");
          }
          return;
        }
        setAiProgress(result.trace ? `AI 참고: ${result.trace}` : "");
        if (result.proposedContent && result.proposedContent !== contentAtRequest) {
          setAiProposal({
            noteId: noteIdAtRequest,
            baseRevision: revisionAtRequest,
            baseContent: contentAtRequest,
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
    [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel, generationOptions, handleAiProgress, beginAiRequest],
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
    const revisionAtRequest = draftRevisionRef.current;
    const contentAtRequest = draft.content;
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
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        loadedNoteIdRef.current !== noteIdAtRequest ||
        draftRevisionRef.current !== revisionAtRequest
      ) {
        if (loadedNoteIdRef.current === noteIdAtRequest) {
          setAiError("AI 처리 중 노트가 변경되어 제안을 적용하지 않았습니다. 다시 요청해 주세요.");
        }
        return;
      }
      setAiProgress(result.trace ? `AI 참고: ${result.trace}` : "");
      // An empty replacement is a valid AI edit (delete the selection).
      if (result.replacementText !== undefined) {
        const nextContent = contentAtRequest.slice(0, start) + result.replacementText + contentAtRequest.slice(end);
        setAiProposal({
          noteId: noteIdAtRequest,
          baseRevision: revisionAtRequest,
          baseContent: contentAtRequest,
          content: nextContent,
          editType: "ai_inline",
          prompt,
          headline: "AI 인라인 편집 제안",
        });
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
  }, [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel, generationOptions, handleAiProgress, beginAiRequest]);

  async function acceptProposal() {
    if (!selectedNoteId || !draft || !aiProposal) return;
    if (aiProposal.noteId !== selectedNoteId || aiProposal.baseRevision !== draftRevisionRef.current) {
      setAiError("제안이 만들어진 뒤 노트가 변경되어 자동 적용을 중단했습니다. 다시 요청해 주세요.");
      setAiProposal(null);
      return;
    }
    clearIdleAutosaveTimer();
    const nextInput: NoteFormInput = {
      ...draft,
      content: aiProposal.content,
      title: aiProposal.title?.trim() || draft.title,
    };
    const proposalEditType = aiProposal.editType;
    const proposalPrompt = aiProposal.prompt;
    commitDraft(nextInput);
    setAiProposal(null);
    const finishSaving = beginSaving();
    try {
      await enqueueNoteUpdate(selectedNoteId, nextInput, proposalEditType, proposalPrompt);
      setSavedMessage("AI 변경을 반영했습니다.");
      window.setTimeout(() => setSavedMessage(""), 2000);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "적용에 실패했습니다.");
    } finally {
      finishSaving();
    }
  }

  async function handleExtractActions() {
    if (!selectedNote || !draft) return;
    const requestedNoteId = selectedNote.id;
    const controller = beginAiRequest();
    setIsAiRunning(true);
    setAiProgress("AI 준비 중…");
    setAiError("");
    try {
      const result = await extractNoteActions({
        noteTitle: draft.title,
        noteContent: draft.content,
        nowIso: new Date().toISOString(),
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (controller.signal.aborted || loadedNoteIdRef.current !== requestedNoteId) return;
      setAiProgress("");
      if (result.length === 0) {
        setAiError("추출할 액션 아이템을 찾지 못했습니다.");
      } else {
        setActionError("");
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
    if (!selectedNote || isCreatingActions) return;
    setIsCreatingActions(true);
    setActionError("");
    try {
      const defaultTypeId = taskTypes.find((type) => type.isActive)?.id ?? taskTypes[0]?.id ?? "";
      const ids = await createTasksForNote(selectedNote.id, actions.map((action) => ({
          title: action.title,
          content: action.content ?? "",
          taskTypeId: defaultTypeId,
          projectId: draft?.projectId ?? selectedNote.projectId,
          status: "NOT_DONE",
          startAt: action.startAtIso,
          isMajor: false,
        })));
      setActionItems(null);
      setSavedMessage(`일정 ${ids.length}건을 만들고 노트에 연결했습니다.`);
      window.setTimeout(() => setSavedMessage(""), 2500);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "일정 생성에 실패했습니다.");
    } finally {
      setIsCreatingActions(false);
    }
  }

  function handleContentContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
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
      onSelect: () => navigate("/settings?section=notes"),
    });
    return items;
  }

  // ✨AI 버튼: 우클릭과 동일한 메뉴를 버튼 바로 아래에 연다
  function handleOpenAiMenuButton(event: MouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setAiMenu({ x: rect.right, y: rect.bottom + 6, align: "end", anchored: true });
  }

  function handleOpenEditorMenu(event: MouseEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setEditorMenu({ x: rect.right, y: rect.bottom + 6, align: "end", anchored: true });
  }

  function buildEditorMenuItems(): ContextMenuItem[] {
    return [
      {
        id: "download-markdown",
        label: "Markdown 다운로드",
        description: "현재 편집 내용과 프론트매터 내보내기",
        disabled: !selectedNote,
        onSelect: () => selectedNote && handleDownloadNote(selectedNote.id),
      },
      {
        id: "history",
        label: "변경 이력",
        description: selectedVersions.length > 0 ? `${selectedVersions.length}개 버전` : "저장된 버전 없음",
        onSelect: () => setHistoryOpen(true),
      },
      { id: "delete", label: "삭제", tone: "danger", onSelect: () => void handleDelete() },
    ];
  }

  async function handleRestoreVersion(versionId: string) {
    if (!selectedNoteId || !selectedNote || !draft || isRestoring) return;
    const version = selectedVersions.find((item) => item.id === versionId);
    if (!version) return;
    const noteId = selectedNoteId;
    const revision = draftRevisionRef.current;
    const restoredInput: NoteFormInput = {
      ...draft,
      title: version.title,
      content: version.content,
    };
    clearIdleAutosaveTimer();
    setIsRestoring(true);
    const finishSaving = beginSaving();
    setErrorMessage("");
    try {
      await noteSaveQueueRef.current;
      const updatedAt = await restoreNoteVersion(noteId, versionId, noteRevisionsRef.current.get(noteId), isDraftDifferentFromNote(selectedNote, draft) ? normalizeNoteDraftSnapshot(draft) : undefined);
      if (!updatedAt) throw new Error("복원할 노트 또는 버전을 찾을 수 없습니다.");
      if (updatedAt) {
        noteRevisionsRef.current.set(noteId, updatedAt);
        savedDraftsRef.current.set(noteId, restoredInput);
        recoverableDrafts.delete(noteId);
      }
      if (loadedNoteIdRef.current !== noteId || draftRevisionRef.current !== revision) return;
      commitDraft(restoredInput);
      setCompareVersion(null);
      setHistoryOpen(false);
      setSavedMessage("이전 버전을 복원했습니다.");
      window.setTimeout(() => setSavedMessage(""), 2000);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "버전을 복원하지 못했습니다.");
    } finally {
      setIsRestoring(false);
      finishSaving();
    }
  }

  function handleOpenTask(taskId: string) {
    navigate("/dashboard");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("ai-planner:focus-task", { detail: { taskId } }));
    }, 80);
  }

  async function handleSummarizeSelected() {
    const targets = notes.filter((note) => checkedIds.has(note.id)).map(noteWithCurrentDraft);
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
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (result.proposedContent) {
        if (controller.signal.aborted) return;
        setBulkProposal({
          input: {
            title: result.proposedTitle?.trim() || `요약 (${targets.length}개)`,
            content: result.proposedContent,
            projectId: targets[0].projectId,
            tags: ["요약"],
            status: "active",
            isPinned: false,
          },
          mode: "summarize", sourceIds: targets.map((note) => note.id), sourceRevisions: {},
        });
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
    let targets = notes.filter((note) => checkedIds.has(note.id)).map(noteWithCurrentDraft);
    if (targets.length < 2) {
      setAiError("병합하려면 노트를 2개 이상 선택해 주세요.");
      return;
    }
    const controller = beginAiRequest();
    setIsAiRunning(true);
    setAiError("");
    try {
      if (selectedNote && draft && isDirty) {
        await enqueueNoteUpdate(selectedNote.id, normalizeNoteDraftSnapshot(draft), "manual");
      }
      await noteSaveQueueRef.current;
      targets = notesRef.current.filter((note) => checkedIds.has(note.id)).map((note) => {
        const revision = noteRevisionsRef.current.get(note.id);
        const saved = savedDraftsRef.current.get(note.id);
        return revision && saved && new Date(revision).getTime() > new Date(note.updatedAt).getTime() ? { ...note, ...saved, updatedAt: revision } : note;
      });
      const sourceRevisions = Object.fromEntries(targets.map((note) => [note.id, note.updatedAt]));
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
        onProgress: handleAiProgress,
        signal: controller.signal,
      });
      if (result.proposedContent) {
        if (controller.signal.aborted) return;
        setBulkProposal({
          input: {
            title: result.proposedTitle?.trim() || `통합 노트 (${targets.length}개)`,
            content: result.proposedContent,
            projectId: targets[0].projectId,
            tags: ["통합"],
            status: "active",
            isPinned: false,
          },
          mode: "merge", sourceIds: targets.map((note) => note.id), sourceRevisions,
        });
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

  function closeBulkProposal() {
    if (isApplyingBulk || !bulkProposal) return;
    const label = bulkProposal.mode === "merge" ? "통합" : "요약";
    const source = notesRef.current.find((note) => note.id === bulkProposal.sourceIds[0]);
    setBulkProposal(null);
    window.requestAnimationFrame(() => {
      const bulkButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".notes-bulk-bar button")).find((button) => button.textContent?.trim() === label);
      const cardButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".note-card-kebab")).find((button) => button.getAttribute("aria-label") === `${source?.title} 메뉴`);
      (bulkButton ?? cardButton)?.focus();
    });
  }

  async function applyBulkProposal() {
    if (!bulkProposal || isApplyingBulk) return;
    setIsApplyingBulk(true);
    setAiError("");
    try {
      const id = bulkProposal.mode === "merge"
        ? await createMergedNote(bulkProposal.input, bulkProposal.sourceIds, "ai_full", "선택 노트 통합", bulkProposal.sourceRevisions)
        : await createNote(bulkProposal.input, "ai_full", "선택 노트 요약");
      setBulkProposal(null);
      setCheckedIds(new Set());
      setSelectionMode(false);
      openNote(id, true);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 결과를 저장하지 못했습니다.");
    } finally {
      setIsApplyingBulk(false);
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

  function exitSelectionMode() {
    setCheckedIds(new Set());
    setSelectionMode(false);
  }

  function returnToAllNotes() {
    if (isRestoring) return;
    priorListRef.current = null;
    setFilterNode({ kind: "all" });
    setSelectedNoteId(null);
    setIsMobileExplorerOpen(false);
    exitSelectionMode();
  }

  function returnToNoteList() {
    if (isRestoring) return;
    if (priorListRef.current) {
      setFilterNode(priorListRef.current.filter);
      setSearch(priorListRef.current.search);
      priorListRef.current = null;
    }
    setSelectedNoteId(null);
    setIsMobileExplorerOpen(false);
  }

  function reloadCurrentNote() {
    if (!selectedNote) return;
    if (isDirty && !window.confirm("현재 수정 내용을 최신 저장본으로 교체할까요? 필요한 내용은 먼저 다운로드해 주세요.")) return;
    clearIdleAutosaveTimer();
    conflictDraftsRef.current.delete(selectedNote.id);
    recoverableDrafts.delete(selectedNote.id);
    noteRevisionsRef.current.set(selectedNote.id, selectedNote.updatedAt);
    savedDraftsRef.current.set(selectedNote.id, noteToInput(selectedNote));
    commitDraft(noteToInput(selectedNote));
    setNoteConflict(false);
    setErrorMessage("");
  }

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
    <div className={`notes-workspace ${selectedNote ? "has-selection" : ""} ${isMobileExplorerOpen ? "mobile-explorer-open" : ""}`}>
      {!selectedNote ? (
        <button
          type="button"
          className="btn btn-soft notes-mobile-explorer-toggle"
          aria-expanded={isMobileExplorerOpen}
          aria-controls="notes-navigation-panel"
          onClick={() => setIsMobileExplorerOpen((open) => !open)}
        >
          탐색
        </button>
      ) : null}

      {isMobileExplorerOpen ? (
        <button
          type="button"
          className="notes-mobile-explorer-backdrop"
          aria-label="탐색 닫기"
          onClick={() => setIsMobileExplorerOpen(false)}
        />
      ) : null}

      {!selectedNote ? (
        <div className="notes-navigation-shell">
          <aside ref={explorerDialogRef} id="notes-navigation-panel" className="notes-navigation-panel" aria-label="노트 탐색" role={isMobileExplorerOpen ? "dialog" : undefined} aria-modal={isMobileExplorerOpen || undefined} tabIndex={isMobileExplorerOpen ? -1 : undefined}>
            <header className="notes-navigation-head">
              <strong>탐색</strong>
              <button
                type="button"
                className="notes-navigation-close"
                aria-label="탐색 닫기"
                onClick={() => setIsMobileExplorerOpen(false)}
              >
                ×
              </button>
            </header>
            <ProjectNoteTree
              projects={projects}
              subcategories={projectSubcategories}
              notes={notes}
              openChecklistCount={openChecklistItems.length}
              selected={filterNode}
              onSelect={(node) => {
                if (isRestoring) return;
                setFilterNode(node);
                setSelectedNoteId(null);
                setIsMobileExplorerOpen(false);
                exitSelectionMode();
              }}
              onAddSubcategory={async (projectId, name) => { await createSubcategory(projectId, name); }}
            />
          </aside>
        </div>
      ) : null}

      <aside className="notes-list-pane" aria-label="노트 목록">
        <header className="notes-list-head">
          <div>
            {selectedNote ? (
              <button
                type="button"
                className="notes-list-nav-trigger"
                aria-label="탐색 및 전체 노트로 돌아가기"
                onClick={returnToAllNotes}
              >
                ☰
              </button>
            ) : null}
            <h2>{listTitle}</h2>
            <span>{filterNode.kind === "checklist" ? filteredChecklistItems.length : filteredNotes.length}개</span>
          </div>
          <div className="notes-list-actions">
            {filterNode.kind !== "checklist" ? (
              <button
                type="button"
                className="btn btn-soft btn-compact"
                aria-pressed={selectionMode}
                onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
              >
                {selectionMode ? "완료" : "선택"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-soft btn-compact"
              disabled={isExportingNotes || notes.length === 0}
              aria-haspopup="menu"
              onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); setExportMenu({ x: bounds.right, y: bounds.bottom + 6 }); }}
            >
              {isExportingNotes ? "내보내는 중" : "내보내기"}
            </button>
            <button type="button" className="btn btn-primary btn-compact" disabled={isCreatingNote} onClick={() => void handleCreateNote()}>
              {isCreatingNote ? "생성 중" : "+ 새 노트"}
            </button>
          </div>
        </header>
        <input
          ref={searchInputRef}
          className="notes-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="노트 검색"
          aria-label="노트 검색"
        />
        {search.trim() ? (
          <div className="notes-search-summary"><span>{listTitle}에서 검색 중</span><button type="button" className="btn btn-soft btn-compact" onClick={() => setSearch("")}>검색 초기화</button></div>
        ) : null}
        {selectedNote && !filteredNotes.some((note) => note.id === selectedNote.id) ? (
          <p className="description-text">편집 중인 노트가 현재 목록 조건에서 제외되어 있습니다. 편집 내용은 유지됩니다.</p>
        ) : null}

        {selectionMode ? (
          <div className="notes-bulk-bar">
            <span>{checkedCount}개 선택{checkedCount > filteredNotes.filter((note) => checkedIds.has(note.id)).length ? ` · 숨겨진 선택 ${checkedCount - filteredNotes.filter((note) => checkedIds.has(note.id)).length}개` : ""}</span>
            <div className="button-row">
              <button type="button" className="btn btn-soft btn-compact" onClick={() => setCheckedIds(new Set(filteredNotes.map((note) => note.id)))} disabled={!filteredNotes.length || isAiRunning}>현재 목록 선택</button>
              <button type="button" className="btn btn-soft btn-compact" onClick={() => void handleSummarizeSelected()} disabled={isAiRunning || checkedCount === 0 || !hasApiConfig}>
                요약
              </button>
              <button type="button" className="btn btn-soft btn-compact" onClick={() => void handleMergeSelected()} disabled={isAiRunning || checkedCount < 2 || !hasApiConfig}>
                통합
              </button>
              <button type="button" className="btn btn-outline btn-compact" onClick={exitSelectionMode}>
                취소
              </button>
            </div>
          </div>
        ) : null}

        {!selectedNote && isAiRunning ? <div className="notes-operation-status" role="status"><span className="note-ai-spinner" aria-hidden="true" />{aiProgress || "AI가 처리 중입니다…"}<button type="button" className="btn btn-soft btn-compact" onClick={() => { abortRef.current?.abort(); setIsAiRunning(false); setAiProgress(""); }}>중단</button></div> : null}
        {!selectedNote && aiError && !bulkProposal ? <p className="error-text notes-operation-status" role="alert">{aiError}</p> : null}
        {!selectedNote && errorMessage ? <p className="error-text notes-operation-status" role="alert">{errorMessage}</p> : null}
        <div className="notes-explorer-list">
        {filterNode.kind === "checklist" ? (
          <div className="notes-checklist-view">
            {filteredChecklistItems.length === 0 ? (
              <p className="empty-text">{search.trim() ? "검색 조건에 맞는 체크리스트 항목이 없습니다." : "미완료 체크리스트 항목이 없습니다."}</p>
            ) : (
              filteredChecklistItems.map((item) => (
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
                      openNote(item.noteId, true);
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
                {search.trim() ? "검색 결과가 없습니다. 검색어를 바꾸거나 검색을 초기화하세요." : filterNode.kind === "archived"
                  ? "보관된 노트가 없습니다. 노트의 더보기 메뉴에서 보관할 수 있어요."
                  : "노트가 없습니다. \"새 노트\"로 시작하세요."}
              </p>
            ) : (
              visibleNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  project={projectMap[note.projectId]}
                  isSelected={note.id === selectedNoteId}
                  isChecked={checkedIds.has(note.id)}
                  showSelection={selectionMode}
                  timeFormat={setting.timeFormat}
                  onSelect={() => {
                    if (isRestoring) return;
                    if (selectionMode) {
                      toggleCheck(note.id, !checkedIds.has(note.id));
                    } else {
                      openNote(note.id);
                    }
                  }}
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
              <button
                type="button"
                className="notes-archived-hint"
                onClick={() => {
                  setFilterNode({ kind: "archived" });
                  setIsMobileExplorerOpen(false);
                }}
              >
                보관된 노트 {archivedMatchCount}개 보기
              </button>
            ) : null}
          </div>
        )}
        </div>
      </aside>

      <section className="notes-detail-scroll" aria-label="노트 내용">
        {selectedNote && isAiRunning ? <div className="notes-operation-status" role="status"><span className="note-ai-spinner" aria-hidden="true" />{aiProgress || "AI가 처리 중입니다…"}<button type="button" className="btn btn-soft btn-compact" onClick={() => { abortRef.current?.abort(); setIsAiRunning(false); setAiProgress(""); }}>중단</button></div> : null}
        {selectedNote && aiError && !bulkProposal ? <p className="error-text notes-operation-status" role="alert">{aiError}</p> : null}
        {selectedNote && draft && currentProject ? (
          <article
            className="notes-detail-pane"
            style={{ "--note-project-color": currentProject.color } as CSSProperties}
          >
            <button
              type="button"
              className="btn btn-soft notes-mobile-detail-back"
              onClick={returnToNoteList}
            >
              ← 노트 목록
            </button>
                    {noteConflict ? (
                      <div className="notes-conflict-panel" role="alert"><p>저장되지 않은 수정 내용이 있습니다. 다른 창의 변경 또는 저장 오류를 확인하세요. 현재 초안은 유지됩니다.</p><div className="button-row"><button type="button" className="btn btn-soft" onClick={() => handleDownloadNote(selectedNote.id)}>내 수정본 다운로드</button><button type="button" className="btn btn-outline" onClick={reloadCurrentNote}>최신 저장본 불러오기</button></div></div>
                    ) : null}
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
                      onOpenAiMenu={handleOpenAiMenuButton}
                      onChangeTitle={handleDraftTitleChange}
                      onChangeContent={handleDraftContentChange}
                      onSave={() => void handleSave("manual")}
                      onOpenMeta={() => setMetaModalOpen(true)}
                      onOpenMoreMenu={handleOpenEditorMenu}
                      onContentContextMenu={handleContentContextMenu}
                      onContentSelectionChange={(start, end) => {
                        selectionRef.current = { start, end };
                      }}
                      isSaving={isSaving}
                      isDirty={isDirty}
                      savedMessage={savedMessage}
                      errorMessage={errorMessage}
                    />

                    {!isAiRunning && aiProgress.startsWith("AI 참고") ? (
                      <p className="note-ai-trace">{aiProgress}</p>
                    ) : null}

                    <NoteConnections
                      linkedTasks={linkedTasks}
                      suggestions={suggestions}
                      relatedNotes={relatedNotes}
                      timeFormat={setting.timeFormat}
                      onOpenTask={handleOpenTask}
                      onOpenNote={(noteId) => openNote(noteId, true)}
                      onLink={(taskId) => void linkNoteToTask(selectedNote.id, taskId, "auto_suggest").catch((error: unknown) => showToast(error instanceof Error ? error.message : "일정을 연결하지 못했습니다.", { tone: "error" }))}
                      onUnlink={(taskId) => void unlinkNoteFromTask(selectedNote.id, taskId).catch((error: unknown) => showToast(error instanceof Error ? error.message : "연결을 해제하지 못했습니다.", { tone: "error" }))}
                      onOpenLinkPicker={() => setTaskLinkOpen(true)}
                      isBusy={isSaving}
                    />
          </article>
        ) : (
          <div className="notes-empty-detail">
            <p className="empty-text">목록에서 노트를 선택하세요.</p>
            <button type="button" className="btn btn-primary notes-empty-action" disabled={isCreatingNote} onClick={() => void handleCreateNote()}>
              {isCreatingNote ? "생성 중" : "+ 새 노트"}
            </button>
          </div>
        )}
      </section>

      {metaModalOpen && draft ? (
        <NoteMetaModal
          draft={draft}
          projects={projects}
          subcategories={projectSubcategories}
          onApply={handleApplyMeta}
          onClose={() => setMetaModalOpen(false)}
        />
      ) : null}

      {actionItems ? (
        <NoteActionModal
          items={actionItems}
          isBusy={isCreatingActions}
          errorMessage={actionError}
          onConfirm={(actions) => void handleCreateActions(actions)}
          onClose={() => { if (!isCreatingActions) { setActionItems(null); window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".note-ai-button")?.focus()); } }}
        />
      ) : null}

      {historyOpen && selectedNote ? (
        <ModalBackdrop className="modal-backdrop" onRequestClose={() => { if (!isRestoring) setHistoryOpen(false); }}>
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
              isBusy={isRestoring}
              currentTitle={draft?.title}
              currentContent={draft?.content}
              onRestore={(versionId) => void handleRestoreVersion(versionId)}
              onCompare={(version) => {
                setCompareVersion(version);
                setHistoryOpen(false);
              }}
              onClose={() => { if (!isRestoring) setHistoryOpen(false); }}
            />
            {errorMessage ? <p className="error-text" role="alert">{errorMessage}</p> : null}
          </div>
        </ModalBackdrop>
      ) : null}

      {bulkProposal ? (
        <ModalBackdrop className="modal-backdrop" onRequestClose={closeBulkProposal}>
          <section ref={bulkDialogRef} className="modal-card note-bulk-preview" role="dialog" aria-modal="true" aria-label="AI 결과 확인" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
            <header className="panel-header note-bulk-preview-header">
              <div>
                <h2>{bulkProposal.mode === "merge" ? "통합 노트 확인" : "요약 노트 확인"}</h2>
                <p className="description-text">{bulkProposal.mode === "merge" ? "결과를 확인하고 저장하면 원본 노트를 보관함으로 옮깁니다." : "결과를 확인하고 새 노트로 저장하세요. 원본 노트는 유지됩니다."}</p>
              </div>
              <button type="button" className="btn btn-soft" disabled={isApplyingBulk} onClick={closeBulkProposal}>닫기</button>
            </header>
            <div className="note-bulk-preview-content" role="region" aria-label="생성된 노트 미리보기" tabIndex={0}>
              <h3 className="note-bulk-preview-title">{bulkProposal.input.title}</h3>
              <MarkdownRenderer content={bulkPreviewBody(bulkProposal.input)} emptyText="" checklistDisabled />
            </div>
            {aiError ? <p className="error-text note-bulk-preview-error" role="alert">{aiError}</p> : null}
            <footer className="button-row note-bulk-preview-actions">
              <button type="button" className="btn btn-soft" disabled={isApplyingBulk} onClick={closeBulkProposal}>취소</button>
              <button type="button" className="btn btn-primary" disabled={isApplyingBulk} onClick={() => void applyBulkProposal()}>{isApplyingBulk ? "저장 중…" : "새 노트로 저장"}</button>
            </footer>
          </section>
        </ModalBackdrop>
      ) : null}
      {taskLinkOpen && selectedNote ? <NoteTaskLinkModal tasks={tasks} excludedIds={selectedNote.linkedTaskIds} timeFormat={setting.timeFormat} onLink={(taskId) => linkNoteToTask(selectedNote.id, taskId, "manual")} onClose={() => setTaskLinkOpen(false)} /> : null}
      {exportMenu ? <ContextMenu x={exportMenu.x} y={exportMenu.y} align="end" anchored items={[
        { id: "all", label: "전체 노트 내보내기", description: "보관된 노트 포함", onSelect: () => void handleExportNotes("all") },
        { id: "visible", label: "현재 목록 내보내기", description: `검색·분류 조건에 맞는 ${filteredNotes.length}개`, disabled: !filteredNotes.length, onSelect: () => void handleExportNotes("visible") },
        { id: "selected", label: "선택한 노트 내보내기", description: `${checkedCount}개`, disabled: !checkedCount, onSelect: () => void handleExportNotes("selected") },
      ]} onClose={() => setExportMenu(null)} /> : null}

      {aiMenu ? (
        <ContextMenu
          x={aiMenu.x}
          y={aiMenu.y}
          align={aiMenu.align}
          anchored={aiMenu.anchored}
          title="AI 편집"
          items={buildAiMenuItems()}
          onClose={() => setAiMenu(null)}
        />
      ) : null}

      {editorMenu ? (
        <ContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          align={editorMenu.align}
          anchored={editorMenu.anchored}
          title="노트"
          items={buildEditorMenuItems()}
          onClose={() => setEditorMenu(null)}
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
