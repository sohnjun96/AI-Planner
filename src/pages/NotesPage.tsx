import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { NoteCard } from "../components/NoteCard";
import { NoteConnections } from "../components/NoteConnections";
import { NoteDiffView } from "../components/NoteDiffView";
import { NoteEditor } from "../components/NoteEditor";
import { NoteHistoryPanel } from "../components/NoteHistoryPanel";
import { NoteMetaModal } from "../components/NoteMetaModal";
import { ProjectNoteTree, type NoteFilterNode } from "../components/ProjectNoteTree";
import { runNotesAgent, suggestTasksForNote } from "../agent/notesAgent";
import {
  DEFAULT_PROJECT_ID,
  MAX_NOTE_TASK_SUGGESTIONS,
  NOTE_SUGGESTION_DATE_WINDOW_DAYS,
} from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Note, NoteAiAction, NoteFormInput, NoteVersion, NoteVersionEditType } from "../models";
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
    projects,
    projectSubcategories,
    setting,
    createNote,
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
  const [aiError, setAiError] = useState("");
  const [aiProposal, setAiProposal] = useState<AiProposal | null>(null);
  const [compareVersion, setCompareVersion] = useState<NoteVersion | null>(null);

  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiMenu, setAiMenu] = useState<{ x: number; y: number } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const loadedNoteIdRef = useRef<string | null>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

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

          // 자동 분류: 미분류 + 세부항목명이 본문에 있으면 배정
          if (!note.subcategoryId) {
            const subs = projectSubcategories.filter((sub) => sub.projectId === note.projectId && sub.name.trim());
            const haystack = `${note.title} ${note.content}`.toLowerCase();
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
  }, [notes, projectSubcategories, selectedNoteId, updateNote]);

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
  }

  const runEditAgent = useCallback(
    async (prompt: string) => {
      if (!selectedNote || !draft) return;
      setIsAiRunning(true);
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
        });
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
        setAiError(error instanceof Error ? error.message : "AI 편집에 실패했습니다.");
      } finally {
        setIsAiRunning(false);
      }
    },
    [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel],
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

    setIsAiRunning(true);
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
      });
      if (result.replacementText) {
        const nextContent = draft.content.slice(0, start) + result.replacementText + draft.content.slice(end);
        setAiProposal({ content: nextContent, editType: "ai_inline", prompt, headline: "AI 인라인 편집 제안" });
      } else {
        setAiError(result.assistantMessage || "변경할 내용을 찾지 못했습니다.");
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI 편집에 실패했습니다.");
    } finally {
      setIsAiRunning(false);
    }
  }, [selectedNote, draft, notes, tasks, projects, setting.llmEndpoint, setting.llmApiKey, setting.llmModel]);

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
    return items;
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
      setAiError(error instanceof Error ? error.message : "요약에 실패했습니다.");
    } finally {
      setIsAiRunning(false);
    }
  }

  async function handleMergeSelected() {
    const targets = notes.filter((note) => checkedIds.has(note.id));
    if (targets.length < 2) {
      setAiError("병합하려면 노트를 2개 이상 선택해 주세요.");
      return;
    }
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
      setAiError(error instanceof Error ? error.message : "통합에 실패했습니다.");
    } finally {
      setIsAiRunning(false);
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
      <aside className="notes-tree-pane">
        <div className="notes-tree-header">
          <h2>노트</h2>
          <button type="button" className="btn btn-primary btn-compact" onClick={() => void handleCreateNote()}>
            + 새 노트
          </button>
        </div>
        <input
          className="notes-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="노트 검색"
          aria-label="노트 검색"
        />
        <ProjectNoteTree
          projects={projects}
          subcategories={projectSubcategories}
          notes={notes}
          selected={filterNode}
          onSelect={(node) => {
            setFilterNode(node);
          }}
          onAddSubcategory={(projectId, name) => void createSubcategory(projectId, name)}
        />
      </aside>

      <section className="notes-list-pane">
        <header className="notes-list-header">
          <div>
            <p className="eyebrow">NOTES</p>
            <h3>{listTitle}</h3>
          </div>
          <span className="notes-list-count">{filteredNotes.length}</span>
        </header>

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
              />
            ))
          )}
        </div>
      </section>

      <main className="notes-detail-pane">
        {selectedNote && draft && currentProject ? (
          <>
            <NoteEditor
              draft={draft}
              projectName={currentProject.name}
              projectColor={currentProject.color}
              subcategoryName={currentSubcategoryName}
              aiActions={aiActions}
              aiEnabled={hasApiConfig}
              isAiRunning={isAiRunning}
              onRunAiAction={(prompt) => void runEditAgent(prompt)}
              onInlineAssist={() => void runInlineAssist()}
              onCustomAi={() => {
                const prompt = window.prompt("AI에게 어떻게 편집할지 알려주세요.");
                if (prompt?.trim()) {
                  void runEditAgent(prompt.trim());
                }
              }}
              onManageAi={() => navigate("/settings")}
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

            {isAiRunning ? <p className="description-text note-ai-running">AI가 처리 중입니다…</p> : null}
            {aiError ? <p className="error-text">{aiError}</p> : null}

            {aiProposal ? (
              <NoteDiffView
                previous={selectedNote.content}
                next={aiProposal.content}
                headline={aiProposal.headline}
                isApplying={isSaving}
                onAccept={() => void acceptProposal()}
                onReject={() => setAiProposal(null)}
              />
            ) : null}

            {compareVersion ? (
              <NoteDiffView
                previous={compareVersion.content}
                next={selectedNote.content}
                headline="선택한 버전 → 현재"
                onAccept={() => setCompareVersion(null)}
                onReject={() => setCompareVersion(null)}
              />
            ) : null}

            <NoteConnections
              linkedTasks={linkedTasks}
              suggestions={suggestions}
              timeFormat={setting.timeFormat}
              onOpenTask={handleOpenTask}
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
    </div>
  );
}
