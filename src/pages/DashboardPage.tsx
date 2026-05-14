import { useEffect, useMemo, useState } from "react";
import { AiAssistantWorkspace } from "../components/AiAssistantWorkspace";
import { MarkdownMemo } from "../components/MarkdownMemo";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput } from "../models";
import { addDays, compareByStartAtAsc, formatDateTime, getDateKey, isPastCompletedHidden } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";

const GLOBAL_MEMO_KEY = "global";

type TaskModalState =
  | {
      mode: "create";
      defaultDate?: string;
    }
  | {
      mode: "edit";
      taskId: string;
    }
  | null;

function toTaskInput(task: Task): TaskFormInput {
  return {
    title: task.title,
    content: task.content,
    taskTypeId: task.taskTypeId,
    projectId: task.projectId,
    status: task.status,
    startAt: task.startAt,
    endAt: task.endAt,
    isMajor: task.isMajor,
  };
}

function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
  }).format(date);
}

function isBetweenDateKeys(value: string, startKey: string, endKey: string): boolean {
  const key = getDateKey(value);
  return key >= startKey && key <= endKey;
}

export function DashboardPage() {
  const { tasks, projects, taskTypes, memos, setting, createTask, updateTask, removeTask, saveMemo } = useAppData();
  const [memoSaved, setMemoSaved] = useState("");
  const [memoError, setMemoError] = useState("");
  const [taskModalState, setTaskModalState] = useState<TaskModalState>(null);
  const [taskFormSerial, setTaskFormSerial] = useState(0);
  const [isAiOpen, setIsAiOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const todayKey = getDateKey(today);
  const weekEndKey = getDateKey(addDays(today, 6));

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted)),
    [tasks, setting.showPastCompleted],
  );

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const memoMap = useMemo(() => Object.fromEntries(memos.map((memo) => [memo.date, memo])), [memos]);
  const conflictMap = useMemo(() => buildTaskConflictMap(visibleTasks), [visibleTasks]);

  const todayTasks = useMemo(
    () => visibleTasks.filter((task) => getDateKey(task.startAt) === todayKey).sort(compareByStartAtAsc),
    [todayKey, visibleTasks],
  );

  const todayOpenTasks = useMemo(() => todayTasks.filter((task) => task.status !== "DONE"), [todayTasks]);

  const weekTasks = useMemo(
    () =>
      visibleTasks
        .filter((task) => isBetweenDateKeys(task.startAt, todayKey, weekEndKey))
        .sort(compareByStartAtAsc),
    [todayKey, visibleTasks, weekEndKey],
  );

  const attention = useMemo(() => {
    const now = Date.now();
    const overdue = visibleTasks
      .filter((task) => task.status !== "DONE" && new Date(task.startAt).getTime() < now)
      .sort(compareByStartAtAsc);
    const conflicts = visibleTasks
      .filter((task) => task.status !== "DONE" && (conflictMap[task.id]?.length ?? 0) > 0)
      .sort(compareByStartAtAsc);
    const important = weekTasks.filter((task) => task.status !== "DONE" && task.isMajor).sort(compareByStartAtAsc);
    const upcoming = weekTasks.filter((task) => task.status !== "DONE").sort(compareByStartAtAsc).slice(0, 5);

    return {
      overdue,
      conflicts,
      important,
      upcoming,
    };
  }, [conflictMap, visibleTasks, weekTasks]);

  const weekStrip = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(today, index);
      const key = getDateKey(date);
      const dayTasks = visibleTasks.filter((task) => getDateKey(task.startAt) === key);
      return {
        key,
        date,
        total: dayTasks.length,
        pending: dayTasks.filter((task) => task.status !== "DONE").length,
      };
    });
  }, [today, visibleTasks]);

  const editingTask = useMemo(() => {
    if (!taskModalState || taskModalState.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);

  const activeTaskModalState: TaskModalState = taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;
  const globalMemoSource = memoMap[GLOBAL_MEMO_KEY]?.content ?? "";

  useEffect(() => {
    if (!activeTaskModalState && !isAiOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTaskModalState(null);
        setIsAiOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTaskModalState, isAiOpen]);

  async function handleCreateTask(input: TaskFormInput) {
    await createTask(input);
    setTaskModalState(null);
    setTaskFormSerial((prev) => prev + 1);
  }

  async function handleUpdateTask(input: TaskFormInput) {
    if (!editingTask) {
      return;
    }
    await updateTask(editingTask.id, input);
  }

  async function handleDeleteTask() {
    if (!editingTask) {
      return;
    }
    await removeTask(editingTask.id);
    setTaskModalState(null);
  }

  async function handleSaveGlobalMemo(content: string) {
    setMemoError("");
    try {
      await saveMemo(GLOBAL_MEMO_KEY, content);
      setMemoSaved("저장 완료");
    } catch (saveError) {
      setMemoError(saveError instanceof Error ? saveError.message : "메모 저장에 실패했습니다.");
      throw saveError;
    }
  }

  function openCreateTask(defaultDate = todayKey) {
    setTaskFormSerial((prev) => prev + 1);
    setTaskModalState({ mode: "create", defaultDate });
  }

  function openEditTask(taskId: string) {
    setTaskModalState({ mode: "edit", taskId });
  }

  function renderTaskList(items: Task[], emptyText: string) {
    if (items.length === 0) {
      return <p className="empty-text">{emptyText}</p>;
    }

    return (
      <div className="task-stack">
        {items.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            project={projectMap[task.projectId]}
            taskType={typeMap[task.taskTypeId]}
            timeFormat={setting.timeFormat}
            hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
            onClick={() => openEditTask(task.id)}
            onStatusChange={(status) => {
              void updateTask(task.id, {
                ...toTaskInput(task),
                status,
              });
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard-workspace">
      <section className="dashboard-today-hero">
        <div>
          <p className="eyebrow">TODAY</p>
          <h2>{formatFullDate(today)}</h2>
          <p className="description-text">오늘 처리할 일과 위험 신호를 먼저 확인합니다.</p>
        </div>
        <div className="dashboard-hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => openCreateTask()}>
            새 일정
          </button>
          <button type="button" className="btn btn-soft" onClick={() => setIsAiOpen(true)}>
            AI 입력
          </button>
        </div>
        <div className="dashboard-summary-row" aria-label="오늘 요약">
          <span>오늘 남은 {todayOpenTasks.length}</span>
          <span>지연 {attention.overdue.length}</span>
          <span>충돌 {attention.conflicts.length}</span>
          <span>중요 {attention.important.length}</span>
        </div>
      </section>

      <div className="dashboard-main-grid">
        <section className="dashboard-card today-task-card">
          <header className="dashboard-card-header">
            <div>
              <p className="eyebrow">TODAY TASKS</p>
              <h3>오늘 할 일</h3>
            </div>
            <span>{todayTasks.length}개</span>
          </header>
          {renderTaskList(todayTasks, "오늘 예정된 일정이 없습니다.")}
          {todayTasks.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => openCreateTask()}>
              새 일정 추가
            </button>
          ) : null}
        </section>

        <aside className="dashboard-side-stack">
          <section className="dashboard-card dashboard-ai-card">
            <header className="dashboard-card-header">
              <div>
                <p className="eyebrow">AI QUICK COMMAND</p>
                <h3>AI 빠른 입력</h3>
              </div>
            </header>
            <AiAssistantWorkspace
              compact
              showEndpointInfo={false}
              title="자연어로 일정 만들기"
              subtitle="요청을 입력하면 AI가 초안과 변경안을 제안합니다."
              placeholder="예: 오늘 오후 4시에 회의 일정 추가해줘."
              className="embedded dashboard-ai-workspace"
            />
          </section>

          <section className="dashboard-card attention-card">
            <header className="dashboard-card-header">
              <div>
                <p className="eyebrow">ATTENTION</p>
                <h3>확인 필요</h3>
              </div>
            </header>
            <div className="attention-list">
              <button type="button" className="attention-item" onClick={() => attention.overdue[0] && openEditTask(attention.overdue[0].id)}>
                <strong>지연 일정</strong>
                <span>{attention.overdue.length}개</span>
              </button>
              <button
                type="button"
                className="attention-item"
                onClick={() => attention.conflicts[0] && openEditTask(attention.conflicts[0].id)}
              >
                <strong>시간 충돌</strong>
                <span>{attention.conflicts.length}개</span>
              </button>
              <button type="button" className="attention-item" onClick={() => attention.important[0] && openEditTask(attention.important[0].id)}>
                <strong>이번 주 중요</strong>
                <span>{attention.important.length}개</span>
              </button>
            </div>
            <div className="upcoming-mini-list">
              <h4>다가오는 일정</h4>
              {attention.upcoming.length === 0 ? <p className="empty-text">이번 주 남은 일정이 없습니다.</p> : null}
              {attention.upcoming.map((task) => (
                <button key={task.id} type="button" className="upcoming-link" onClick={() => openEditTask(task.id)}>
                  <span>{task.title}</span>
                  <small>{formatDateTime(task.startAt, setting.timeFormat)}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="dashboard-card week-strip-card">
        <header className="dashboard-card-header">
          <div>
            <p className="eyebrow">THIS WEEK</p>
            <h3>이번 주</h3>
          </div>
          <small>
            {todayKey} - {weekEndKey}
          </small>
        </header>
        <div className="week-strip">
          {weekStrip.map((day) => (
            <button key={day.key} type="button" className="week-day-cell" onClick={() => openCreateTask(day.key)}>
              <strong>{formatWeekday(day.date)}</strong>
              <span>{day.date.getDate()}</span>
              <small>전체 {day.total}</small>
              <small>남은 {day.pending}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-memo-section">
        <MarkdownMemo
          content={globalMemoSource}
          savedMessage={memoSaved}
          errorMessage={memoError}
          onEditStart={() => {
            setMemoSaved("");
            setMemoError("");
          }}
          onSave={handleSaveGlobalMemo}
        />
      </section>

      {isAiOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsAiOpen(false);
          }}
        >
          <section
            className="modal-card panel ai-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="AI 일정 입력"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <div>
                <p className="eyebrow">AI COMMAND</p>
                <h2>AI 일정 입력</h2>
              </div>
              <button type="button" className="btn btn-soft" onClick={() => setIsAiOpen(false)}>
                닫기
              </button>
            </header>
            <AiAssistantWorkspace compact showEndpointInfo={false} className="embedded" />
          </section>
        </div>
      ) : null}

      {activeTaskModalState ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setTaskModalState(null);
          }}
        >
          <section
            className="modal-card panel"
            role="dialog"
            aria-modal="true"
            aria-label="일정 상세 또는 수정"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>{activeTaskModalState.mode === "create" ? "일정 추가" : "일정 수정"}</h2>
              <button type="button" className="btn btn-soft" onClick={() => setTaskModalState(null)}>
                닫기
              </button>
            </header>

            {activeTaskModalState.mode === "create" ? (
              <TaskForm
                key={`dashboard-new-task-${activeTaskModalState.defaultDate ?? todayKey}-${taskFormSerial}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                defaultStartDate={activeTaskModalState.defaultDate ?? todayKey}
                timeFormat={setting.timeFormat}
                onSubmit={handleCreateTask}
              />
            ) : editingTask ? (
              <TaskForm
                key={`dashboard-edit-task-${editingTask.id}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                initialTask={editingTask}
                timeFormat={setting.timeFormat}
                onSubmit={handleUpdateTask}
                onDelete={handleDeleteTask}
                onCancel={() => setTaskModalState(null)}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
