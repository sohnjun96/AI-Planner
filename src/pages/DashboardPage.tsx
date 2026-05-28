import { useEffect, useMemo, useState } from "react";
import { AiAssistantWorkspace } from "../components/AiAssistantWorkspace";
import { MarkdownMemo } from "../components/MarkdownMemo";
import { MonthCalendar, type CalendarDaySummary } from "../components/MonthCalendar";
import { TaskForm } from "../components/TaskForm";
import { STATUS_LABELS } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Project, Task, TaskFormInput, TaskStatus, TaskType } from "../models";
import { compareByStartAtAsc, getDateKey, isPastCompletedHidden, shiftIsoToDateKey } from "../utils/date";
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

type AgendaViewMode = "priority" | "all";

const EMPTY_DAY_SUMMARY: CalendarDaySummary = {
  total: 0,
  done: 0,
  pending: 0,
  onHold: 0,
  conflicts: 0,
  major: 0,
  titles: [],
};

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

function formatDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(dateKey));
}

function formatTimeOnly(value: string, timeFormat: "24h" | "12h"): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(new Date(value));
}

function formatTaskTime(task: Task, timeFormat: "24h" | "12h"): string {
  const startTime = formatTimeOnly(task.startAt, timeFormat);
  return task.endAt ? `${startTime} - ${formatTimeOnly(task.endAt, timeFormat)}` : startTime;
}

interface CompactTaskCardProps {
  task: Task;
  project?: Project;
  taskType?: TaskType;
  timeFormat: "24h" | "12h";
  hasConflict: boolean;
  onClick: () => void;
  onStatusChange: (status: TaskStatus) => void;
}

function CompactTaskCard({
  task,
  project,
  taskType,
  timeFormat,
  hasConflict,
  onClick,
  onStatusChange,
}: CompactTaskCardProps) {
  return (
    <article
      className={`compact-task-card ${task.status.toLowerCase()} ${hasConflict ? "has-conflict" : ""}`}
      style={{ borderLeftColor: project?.color ?? "#64748b" }}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-task-id", task.id);
        event.dataTransfer.setData("text/plain", task.id);
      }}
    >
      <button type="button" className="compact-task-main" onClick={onClick}>
        <span className="compact-task-time">{formatTaskTime(task, timeFormat)}</span>
        <span className="compact-task-title">{task.title}</span>
        <span className={`status-badge ${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span>
      </button>

      <div className="compact-task-footer">
        <span className="compact-task-meta">
          <span style={{ color: project?.color ?? "#475569" }}>{project?.name ?? "프로젝트 없음"}</span>
          <span>{taskType?.name ?? "종류 없음"}</span>
          {task.isMajor ? <span className="compact-major">중요</span> : null}
          {hasConflict ? <span className="compact-conflict">충돌</span> : null}
        </span>

        <div className="compact-status-row" aria-label={`${task.title} 상태 변경`}>
          {(["NOT_DONE", "ON_HOLD", "DONE"] as TaskStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`compact-status-button ${status.toLowerCase()} ${task.status === status ? "active" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onStatusChange(status);
              }}
              aria-pressed={task.status === status}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

export function DashboardPage() {
  const { tasks, projects, taskTypes, memos, setting, createTask, updateTask, removeTask, saveMemo } = useAppData();
  const [memoSaved, setMemoSaved] = useState("");
  const [memoError, setMemoError] = useState("");
  const [taskModalState, setTaskModalState] = useState<TaskModalState>(null);
  const [taskFormSerial, setTaskFormSerial] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => getDateKey(new Date()));
  const [agendaViewPreference, setAgendaViewPreference] = useState<{ date: string; mode: AgendaViewMode } | null>(null);

  const today = useMemo(() => new Date(), []);
  const todayKey = getDateKey(today);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted)),
    [tasks, setting.showPastCompleted],
  );
  const calendarTasks = tasks;

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const memoMap = useMemo(() => Object.fromEntries(memos.map((memo) => [memo.date, memo])), [memos]);
  const conflictMap = useMemo(() => buildTaskConflictMap(visibleTasks), [visibleTasks]);
  const calendarConflictMap = useMemo(() => buildTaskConflictMap(calendarTasks), [calendarTasks]);

  const todayTasks = useMemo(
    () => visibleTasks.filter((task) => getDateKey(task.startAt) === todayKey).sort(compareByStartAtAsc),
    [todayKey, visibleTasks],
  );

  const selectedDayTasks = useMemo(
    () => calendarTasks.filter((task) => getDateKey(task.startAt) === selectedDate).sort(compareByStartAtAsc),
    [calendarTasks, selectedDate],
  );

  const selectedDayPriorityTasks = useMemo(
    () => selectedDayTasks.filter((task) => task.status === "NOT_DONE" || task.status === "ON_HOLD"),
    [selectedDayTasks],
  );

  const agendaViewMode = agendaViewPreference?.date === selectedDate ? agendaViewPreference.mode : "priority";
  const hasPriorityAgendaTasks = selectedDayPriorityTasks.length > 0;
  const agendaTasks = agendaViewMode === "all" || !hasPriorityAgendaTasks ? selectedDayTasks : selectedDayPriorityTasks;

  const daySummaryByDate = useMemo(() => {
    return calendarTasks.reduce<Record<string, CalendarDaySummary>>((summaryMap, task) => {
      const key = getDateKey(task.startAt);
      const current = summaryMap[key] ?? { ...EMPTY_DAY_SUMMARY, titles: [] };
      current.total += 1;
      current.done += task.status === "DONE" ? 1 : 0;
      current.pending += task.status === "NOT_DONE" ? 1 : 0;
      current.onHold += task.status === "ON_HOLD" ? 1 : 0;
      current.conflicts += (calendarConflictMap[task.id]?.length ?? 0) > 0 ? 1 : 0;
      current.major += task.isMajor ? 1 : 0;
      current.titles.push(task.title);
      summaryMap[key] = current;
      return summaryMap;
    }, {});
  }, [calendarConflictMap, calendarTasks]);

  const selectedDaySummary = daySummaryByDate[selectedDate] ?? EMPTY_DAY_SUMMARY;

  const editingTask = useMemo(() => {
    if (!taskModalState || taskModalState.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);

  const activeTaskModalState: TaskModalState = taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;
  const globalMemoSource = memoMap[GLOBAL_MEMO_KEY]?.content ?? "";

  useEffect(() => {
    if (!activeTaskModalState) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTaskModalState(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTaskModalState]);

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

  async function handleDropTaskToDate(taskId: string, dateKey: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }

    await updateTask(task.id, {
      ...toTaskInput(task),
      startAt: shiftIsoToDateKey(task.startAt, dateKey),
      endAt: task.endAt ? shiftIsoToDateKey(task.endAt, dateKey) : undefined,
    });
  }

  function openCreateTask(defaultDate = selectedDate) {
    setTaskFormSerial((prev) => prev + 1);
    setTaskModalState({ mode: "create", defaultDate });
  }

  function openEditTask(taskId: string) {
    setTaskModalState({ mode: "edit", taskId });
  }

  function changeTaskStatus(task: Task, status: TaskStatus) {
    void updateTask(task.id, {
      ...toTaskInput(task),
      status,
    });
  }

  function renderCompactTasks(items: Task[], emptyText: string) {
    if (items.length === 0) {
      return <p className="empty-text">{emptyText}</p>;
    }

    return (
      <div className="compact-task-list">
        {items.map((task) => (
          <CompactTaskCard
            key={task.id}
            task={task}
            project={projectMap[task.projectId]}
            taskType={typeMap[task.taskTypeId]}
            timeFormat={setting.timeFormat}
            hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
            onClick={() => openEditTask(task.id)}
            onStatusChange={(status) => changeTaskStatus(task, status)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard-workspace">
      <section className="dashboard-topbar compact-dashboard-topbar">
        <div>
          <p className="eyebrow">TODAY</p>
          <h2>{formatFullDate(today)}</h2>
        </div>
        <div className="dashboard-hero-actions">
          <button type="button" className="btn btn-primary" onClick={() => openCreateTask(todayKey)}>
            일정 추가
          </button>
        </div>
      </section>

      <div className="dashboard-primary-grid">
        <section className="dashboard-card dashboard-calendar-card premium-calendar-card">
          <header className="dashboard-card-header">
            <div>
              <p className="eyebrow">CALENDAR</p>
              <h3>일정 보드</h3>
            </div>
          </header>

          <div className="dashboard-calendar-layout">
            <div className="dashboard-calendar-month">
              <MonthCalendar
                selectedDate={selectedDate}
                weekStartsOn={setting.weekStartsOn}
                daySummaryByDate={daySummaryByDate}
                onSelectDate={setSelectedDate}
                onDropTaskToDate={handleDropTaskToDate}
                onCreateTaskAtDate={openCreateTask}
              />
            </div>

            <aside className="dashboard-agenda-panel" aria-label="선택한 날짜의 일정">
              <header>
                <div>
                  <p className="eyebrow">AGENDA</p>
                  <h4>{formatDateLabel(selectedDate)}</h4>
                </div>
                <span>{agendaTasks.length}/{selectedDayTasks.length}개</span>
              </header>

              <div className="agenda-stat-grid">
                <button
                  type="button"
                  className={`all ${agendaViewMode === "all" ? "active" : ""}`}
                  onClick={() => {
                    setAgendaViewPreference({ date: selectedDate, mode: agendaViewMode === "all" ? "priority" : "all" });
                  }}
                  aria-pressed={agendaViewMode === "all"}
                >
                  전체 {selectedDaySummary.total}
                </button>
                <span className="not_done">미완료 {selectedDaySummary.pending}</span>
                <span className="on_hold">보류 {selectedDaySummary.onHold}</span>
                <span className="done">완료 {selectedDaySummary.done}</span>
                <span className="conflict">충돌 {selectedDaySummary.conflicts}</span>
              </div>

              <div className="agenda-timeline">
                {agendaTasks.length === 0 ? (
                  <div className="agenda-empty">
                    <strong>이 날짜에는 일정이 없습니다.</strong>
                    <p>달력의 날짜를 더블클릭하면 바로 일정을 추가할 수 있습니다.</p>
                  </div>
                ) : null}

                {agendaTasks.map((task) => {
                  const project = projectMap[task.projectId];
                  const taskType = typeMap[task.taskTypeId];
                  const hasConflict = (calendarConflictMap[task.id]?.length ?? 0) > 0;

                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`agenda-event-card ${task.status.toLowerCase()} ${hasConflict ? "conflict" : ""}`}
                      style={{ borderLeftColor: project?.color ?? "#6b7280" }}
                      onClick={() => openEditTask(task.id)}
                    >
                      <span className="agenda-event-time">{formatTaskTime(task, setting.timeFormat)}</span>
                      <strong>{task.title}</strong>
                      <small>
                        {project?.name ?? "프로젝트 없음"} · {taskType?.name ?? "종류 없음"}
                      </small>
                      <span className="agenda-event-badges">
                        <span className={`status-badge ${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span>
                        {task.isMajor ? <span className="major-tag">중요</span> : null}
                        {hasConflict ? <span className="conflict-badge">충돌</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </section>

        <aside className="dashboard-side-column">
          <section className="dashboard-card dashboard-ai-main-card">
            <header className="dashboard-card-header">
              <div>
                <p className="eyebrow">AI INPUT</p>
                <h3>AI로 일정 만들기</h3>
              </div>
            </header>
            <AiAssistantWorkspace
              compact
              hideInitialResult
              resultPresentation="modal"
              showRetryButton={false}
              showEndpointInfo={false}
              title="AI로 일정 만들기"
              subtitle=""
              inputLabel=""
              placeholder=""
              className="embedded dashboard-ai-workspace dashboard-ai-main-workspace"
            />
          </section>

          <section className="dashboard-card today-task-card">
            <header className="dashboard-card-header">
              <div>
                <p className="eyebrow">TODAY</p>
                <h3>오늘 할 일</h3>
              </div>
              <span>{todayTasks.length}개</span>
            </header>
            {renderCompactTasks(todayTasks, "오늘 등록된 일정이 없습니다.")}
          </section>
        </aside>
      </div>

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
                key={`dashboard-new-task-${activeTaskModalState.defaultDate ?? selectedDate}-${taskFormSerial}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                defaultStartDate={activeTaskModalState.defaultDate ?? selectedDate}
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
