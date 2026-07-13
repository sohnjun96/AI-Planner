import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "../agent/agentUtils";
import { runBriefing, type BriefingNote, type BriefingTask } from "../agent/briefingAgent";
import { DEFAULT_PROJECT_ID, STATUS_LABELS } from "../constants";
import { useAppData } from "../context/AppDataContext";
import { buildTaskConflictMap } from "../utils/taskConflicts";
import { formatDateTime, getDateKey, toIsoNow } from "../utils/date";
import { isTaskCanceled, isTaskDone } from "../utils/taskStatus";
import { MarkdownRenderer } from "./MarkdownRenderer";

function toSnippet(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function DailyBriefing() {
  const { tasks, notes, projects, taskTypes, setting, userContext, createNote } = useAppData();
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [briefing, setBriefing] = useState("");
  const [error, setError] = useState("");
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasApiConfig = Boolean((setting.llmEndpoint ?? "").trim());
  const todayKey = getDateKey(new Date());

  // 모달을 닫으면 진행 중인 브리핑 생성을 중단한다.
  const closeModal = useCallback(() => {
    abortRef.current?.abort();
    setIsOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeModal]);

  function buildContext() {
    const projectMap = Object.fromEntries(projects.map((project) => [project.id, project]));
    const typeMap = Object.fromEntries(taskTypes.map((type) => [type.id, type]));
    const now = Date.now();

    const toBriefingTask = (task: (typeof tasks)[number]): BriefingTask => ({
      id: task.id,
      title: task.title,
      time: formatDateTime(task.startAt, setting.timeFormat),
      endAt: task.endAt,
      status: STATUS_LABELS[task.status],
      projectName: projectMap[task.projectId]?.name ?? "",
      typeName: typeMap[task.taskTypeId]?.name ?? "",
      isMajor: task.isMajor,
    });

    const todayTasksRaw = tasks
      .filter((task) => getDateKey(task.startAt) === todayKey && !isTaskCanceled(task.status))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 20);
    const todayTasks = todayTasksRaw.map(toBriefingTask);

    const overdueTasks = tasks
      .filter(
        (task) =>
          new Date(task.startAt).getTime() < now &&
          getDateKey(task.startAt) !== todayKey &&
          !isTaskDone(task.status) &&
          !isTaskCanceled(task.status),
      )
      .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
      .slice(0, 8)
      .map(toBriefingTask);

    const conflictMap = buildTaskConflictMap(todayTasksRaw);
    const titleById = Object.fromEntries(todayTasksRaw.map((task) => [task.id, task.title]));
    const seen = new Set<string>();
    const conflicts: string[] = [];
    for (const [id, others] of Object.entries(conflictMap)) {
      for (const otherId of others) {
        const key = [id, otherId].sort().join("|");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        conflicts.push(`${titleById[id] ?? ""} ↔ ${titleById[otherId] ?? ""}`);
      }
    }

    const openChecklistCount = notes.reduce((count, note) => {
      const matches = note.content.match(/^\s*[-*+]\s+\[ \]\s+/gm);
      return count + (matches?.length ?? 0);
    }, 0);

    const recentNotes: BriefingNote[] = [...notes]
      .filter((note) => note.status !== "archived")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6)
      .map((note) => ({
        id: note.id,
        title: note.title,
        snippet: toSnippet(note.content),
        projectName: projectMap[note.projectId]?.name ?? "",
      }));

    return { todayTasks, overdueTasks, conflicts, openChecklistCount, recentNotes };
  }

  async function handleRun() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    setError("");
    setBriefing("");
    setSavedNoteId(null);
    try {
      const context = buildContext();
      const result = await runBriefing({
        nowText: formatDateTime(toIsoNow(), setting.timeFormat),
        ...context,
        userPreferences: userContext.rules
          .filter((rule) => rule.isActive && rule.category === "preference")
          .map((rule) => ({ label: rule.label, note: rule.note })),
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        signal: controller.signal,
        onToken: (delta) => setBriefing((prev) => prev + delta),
      });
      setBriefing(result);
    } catch (runError) {
      if (isAbortError(runError)) return;
      setError(runError instanceof Error ? runError.message : "브리핑 생성에 실패했습니다.");
    } finally {
      if (abortRef.current === controller) {
        setIsRunning(false);
      }
    }
  }

  function openAndRun() {
    setIsOpen(true);
    if (hasApiConfig) {
      void handleRun();
    }
  }

  async function handleSaveNote() {
    if (!briefing.trim()) {
      return;
    }
    const activeProjectId = projects.find((project) => project.isActive)?.id ?? DEFAULT_PROJECT_ID;
    const id = await createNote(
      {
        title: `브리핑 ${todayKey}`,
        content: briefing,
        projectId: activeProjectId,
        subcategoryId: undefined,
        tags: ["브리핑"],
        status: "active",
        isPinned: false,
      },
      "manual",
    );
    setSavedNoteId(id);
  }

  return (
    <>
      <button type="button" className="daily-briefing-trigger" onClick={openAndRun}>
        <span className="daily-briefing-icon" aria-hidden="true">
          ☀️
        </span>
        <span>
          <strong>AI 브리핑</strong>
          <small>오늘 하루를 정리해 드려요</small>
        </span>
      </button>

      {isOpen ? (
        <div className="modal-backdrop" onClick={closeModal}>
          <section
            className="modal-card briefing-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="AI 아침 브리핑"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="panel-header">
              <div>
                <p className="eyebrow">DAILY BRIEFING</p>
                <h2>오늘의 브리핑</h2>
                <small>{todayKey}</small>
              </div>
              <button type="button" className="btn btn-soft" onClick={closeModal}>
                닫기
              </button>
            </header>

            {!hasApiConfig ? (
              <p className="description-text">설정에서 LLM 엔드포인트와 API 키를 먼저 입력해 주세요.</p>
            ) : null}

            <div className="briefing-body">
              {isRunning && !briefing ? (
                <p className="note-ai-running">
                  <span className="note-ai-spinner" aria-hidden="true" />
                  오늘 일정과 메모를 살펴보는 중…
                </p>
              ) : briefing ? (
                <MarkdownRenderer content={briefing} />
              ) : error ? null : (
                <p className="empty-text">브리핑을 생성하려면 아래 버튼을 눌러 주세요.</p>
              )}
              {error ? <p className="error-text">{error}</p> : null}
            </div>

            <div className="button-row">
              <button type="button" className="btn btn-soft" onClick={() => void handleRun()} disabled={isRunning || !hasApiConfig}>
                {isRunning ? "생성 중…" : briefing ? "다시 생성" : "브리핑 생성"}
              </button>
              {briefing && !savedNoteId ? (
                <button type="button" className="btn btn-primary" onClick={() => void handleSaveNote()} disabled={isRunning}>
                  노트로 저장
                </button>
              ) : null}
              {savedNoteId ? <span className="success-text">노트로 저장했습니다.</span> : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
