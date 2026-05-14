import { useEffect, useMemo, useState } from "react";
import { type CalendarDaySummary, MonthCalendar } from "../components/MonthCalendar";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";
import { addDays, compareByStartAtAsc, formatDateTime, getDateKey, isPastCompletedHidden, shiftIsoToDateKey } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";

type QuickFilter = "ALL" | "TODAY" | "WEEK" | "PENDING" | "CONFLICT" | "MAJOR";
type ViewMode = "LIST" | "WEEK" | "MONTH";
type DetailMode = "empty" | "create" | "edit";

const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "TODAY", label: "오늘" },
  { value: "WEEK", label: "이번 주" },
  { value: "PENDING", label: "미완료" },
  { value: "CONFLICT", label: "충돌" },
  { value: "MAJOR", label: "중요" },
];

const VIEW_MODES: Array<{ value: ViewMode; label: string }> = [
  { value: "LIST", label: "목록" },
  { value: "WEEK", label: "주간" },
  { value: "MONTH", label: "월간" },
];

const EMPTY_SUMMARY: CalendarDaySummary = {
  total: 0,
  done: 0,
  pending: 0,
  onHold: 0,
  conflicts: 0,
  major: 0,
  titles: [],
};

function toTaskInput(task: Task, statusOverride?: TaskStatus): TaskFormInput {
  return {
    title: task.title,
    content: task.content,
    taskTypeId: task.taskTypeId,
    projectId: task.projectId,
    status: statusOverride ?? task.status,
    startAt: task.startAt,
    endAt: task.endAt,
    isMajor: task.isMajor,
  };
}

function isInCurrentWeek(task: Task): boolean {
  const todayKey = getDateKey(new Date());
  const weekEndKey = getDateKey(addDays(new Date(), 7));
  const taskKey = getDateKey(task.startAt);
  return taskKey >= todayKey && taskKey <= weekEndKey;
}

function getWeekStart(dateKey: string, weekStartsOn: "sun" | "mon"): Date {
  const source = new Date(`${dateKey}T00:00:00`);
  const currentDay = source.getDay();
  const startIndex = weekStartsOn === "mon" ? 1 : 0;
  const diff = (currentDay - startIndex + 7) % 7;
  return addDays(source, -diff);
}

function groupVisibleTasks(tasks: Task[]) {
  const todayKey = getDateKey(new Date());
  const tomorrowKey = getDateKey(addDays(new Date(), 1));
  const weekEndKey = getDateKey(addDays(new Date(), 7));

  const groups = [
    { id: "today", title: "오늘", tasks: [] as Task[] },
    { id: "tomorrow", title: "내일", tasks: [] as Task[] },
    { id: "week", title: "이번 주", tasks: [] as Task[] },
    { id: "later", title: "이후", tasks: [] as Task[] },
    { id: "done", title: "완료", tasks: [] as Task[] },
  ];

  for (const task of tasks) {
    if (task.status === "DONE") {
      groups[4].tasks.push(task);
      continue;
    }

    const taskKey = getDateKey(task.startAt);
    if (taskKey === todayKey) {
      groups[0].tasks.push(task);
    } else if (taskKey === tomorrowKey) {
      groups[1].tasks.push(task);
    } else if (taskKey > tomorrowKey && taskKey <= weekEndKey) {
      groups[2].tasks.push(task);
    } else {
      groups[3].tasks.push(task);
    }
  }

  return groups
    .map((group) => ({ ...group, tasks: group.tasks.sort(compareByStartAtAsc) }))
    .filter((group) => group.tasks.length > 0);
}

function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function TasksPage() {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask } = useAppData();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [keyword, setKeyword] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("LIST");
  const [projectId, setProjectId] = useState("");
  const [taskTypeId, setTaskTypeId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => getDateKey(new Date()));
  const [detailMode, setDetailMode] = useState<DetailMode>("empty");
  const [createFormKey, setCreateFormKey] = useState(0);
  const [createDefaultDate, setCreateDefaultDate] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dropMessage, setDropMessage] = useState("");
  const [dropError, setDropError] = useState("");

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const conflictMap = useMemo(() => buildTaskConflictMap(tasks), [tasks]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000);
    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [selectedTaskId, tasks]);

  useEffect(() => {
    if (detailMode === "edit" && selectedTaskId && !selectedTask) {
      setSelectedTaskId(null);
      setDetailMode("empty");
    }
  }, [detailMode, selectedTask, selectedTaskId]);

  const filteredTasks = useMemo(() => {
    const trimmedKeyword = keyword.trim().toLowerCase();

    return tasks
      .filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted))
      .filter((task) => {
        if (projectId && task.projectId !== projectId) {
          return false;
        }
        if (taskTypeId && task.taskTypeId !== taskTypeId) {
          return false;
        }
        if (quickFilter === "TODAY" && getDateKey(task.startAt) !== getDateKey(new Date())) {
          return false;
        }
        if (quickFilter === "WEEK" && !isInCurrentWeek(task)) {
          return false;
        }
        if (quickFilter === "PENDING" && task.status === "DONE") {
          return false;
        }
        if (quickFilter === "CONFLICT" && (conflictMap[task.id]?.length ?? 0) === 0) {
          return false;
        }
        if (quickFilter === "MAJOR" && !task.isMajor) {
          return false;
        }
        if (!trimmedKeyword) {
          return true;
        }

        const projectName = projectMap[task.projectId]?.name ?? "";
        const typeName = typeMap[task.taskTypeId]?.name ?? "";
        return `${task.title} ${task.content} ${projectName} ${typeName}`.toLowerCase().includes(trimmedKeyword);
      })
      .sort(compareByStartAtAsc);
  }, [conflictMap, keyword, projectId, projectMap, quickFilter, setting.showPastCompleted, taskTypeId, tasks, typeMap]);

  const groupedTasks = useMemo(() => groupVisibleTasks(filteredTasks), [filteredTasks]);

  const daySummaryByDate = useMemo(() => {
    const map: Record<string, CalendarDaySummary> = {};

    for (const task of filteredTasks) {
      const key = getDateKey(task.startAt);
      if (!map[key]) {
        map[key] = { ...EMPTY_SUMMARY, titles: [] };
      }

      const summary = map[key];
      summary.total += 1;
      if (task.status === "DONE") {
        summary.done += 1;
      } else {
        summary.pending += 1;
      }
      if (task.status === "ON_HOLD") {
        summary.onHold += 1;
      }
      if (task.isMajor) {
        summary.major += 1;
      }
      if ((conflictMap[task.id]?.length ?? 0) > 0) {
        summary.conflicts += 1;
      }
      if (summary.titles.length < 3) {
        summary.titles.push(task.title);
      }
    }

    return map;
  }, [conflictMap, filteredTasks]);

  const selectedDateTasks = useMemo(
    () => filteredTasks.filter((task) => getDateKey(task.startAt) === selectedDate).sort(compareByStartAtAsc),
    [filteredTasks, selectedDate],
  );

  const weekStart = useMemo(() => getWeekStart(selectedDate, setting.weekStartsOn), [selectedDate, setting.weekStartsOn]);
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(weekStart, index);
        const key = getDateKey(date);
        const items = filteredTasks.filter((task) => getDateKey(task.startAt) === key).sort(compareByStartAtAsc);
        return { date, key, tasks: items };
      }),
    [filteredTasks, weekStart],
  );

  const taskStats = useMemo(() => {
    const activeSource = tasks.filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted));
    return {
      total: activeSource.length,
      pending: activeSource.filter((task) => task.status !== "DONE").length,
      today: activeSource.filter((task) => getDateKey(task.startAt) === getDateKey(new Date())).length,
      conflicts: activeSource.filter((task) => (conflictMap[task.id]?.length ?? 0) > 0).length,
      overdue: activeSource.filter((task) => task.status !== "DONE" && new Date(task.startAt).getTime() < currentTime).length,
    };
  }, [conflictMap, currentTime, setting.showPastCompleted, tasks]);

  function openCreatePanel(defaultDate?: string) {
    setError("");
    setMessage("");
    setSelectedTaskId(null);
    setCreateDefaultDate(defaultDate);
    setDetailMode("create");
    setCreateFormKey((prev) => prev + 1);
  }

  function openTask(taskId: string) {
    setError("");
    setMessage("");
    setSelectedTaskId(taskId);
    setDetailMode("edit");
  }

  async function handleCreate(input: TaskFormInput) {
    setError("");
    await createTask(input);
    setMessage("일정을 추가했습니다.");
    setDetailMode("empty");
  }

  async function handleUpdate(input: TaskFormInput) {
    if (!selectedTaskId) {
      return;
    }
    setError("");
    await updateTask(selectedTaskId, input);
    setMessage("일정을 저장했습니다.");
  }

  async function handleDelete() {
    if (!selectedTaskId) {
      return;
    }
    setError("");
    await removeTask(selectedTaskId);
    setSelectedTaskId(null);
    setDetailMode("empty");
    setMessage("일정을 삭제했습니다.");
  }

  async function handleDropTaskToDate(taskId: string, dateKey: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }

    setDropError("");
    setDropMessage("");
    try {
      const nextStartAt = shiftIsoToDateKey(task.startAt, dateKey);
      const startAtMs = new Date(task.startAt).getTime();
      const endAtMs = task.endAt ? new Date(task.endAt).getTime() : Number.NaN;
      const durationMs = Number.isFinite(startAtMs) && Number.isFinite(endAtMs) && endAtMs >= startAtMs ? endAtMs - startAtMs : null;
      const nextEndAt = task.endAt
        ? durationMs !== null
          ? new Date(new Date(nextStartAt).getTime() + durationMs).toISOString()
          : shiftIsoToDateKey(task.endAt, dateKey)
        : undefined;

      await updateTask(task.id, {
        ...toTaskInput(task),
        startAt: nextStartAt,
        endAt: nextEndAt,
      });
      setSelectedDate(dateKey);
      setDropMessage(`"${task.title}" 일정을 ${dateKey}(으)로 이동했습니다.`);
    } catch (moveError) {
      setDropError(moveError instanceof Error ? moveError.message : "일정 이동에 실패했습니다.");
    }
  }

  function resetFilters() {
    setKeyword("");
    setQuickFilter("ALL");
    setProjectId("");
    setTaskTypeId("");
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
            selected={selectedTaskId === task.id}
            hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
            onClick={() => openTask(task.id)}
            onStatusChange={(status) => {
              void updateTask(task.id, toTaskInput(task, status)).catch((updateError) => {
                setError(updateError instanceof Error ? updateError.message : "상태 변경에 실패했습니다.");
              });
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="tasks-workspace">
      <section className="tasks-overview">
        <div>
          <p className="eyebrow">TASKS</p>
          <h2>일정</h2>
          <p className="description-text">일정을 목록, 주간, 월간 보기로 전환하며 찾고 조정합니다.</p>
        </div>
        <div className="overview-stat-row" aria-label="일정 요약">
          <span>전체 {taskStats.total}</span>
          <span>오늘 {taskStats.today}</span>
          <span>미완료 {taskStats.pending}</span>
          <span>충돌 {taskStats.conflicts}</span>
          <span>지연 {taskStats.overdue}</span>
        </div>
      </section>

      <section className="tasks-control-bar" aria-label="일정 검색과 필터">
        <label className="search-field">
          검색
          <input
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="제목, 내용, 프로젝트, 종류 검색"
          />
        </label>
        <div className="chip-row" role="group" aria-label="빠른 필터">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`filter-chip ${quickFilter === filter.value ? "active" : ""}`}
              onClick={() => setQuickFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openCreatePanel(selectedDate)}>
          새 일정
        </button>
      </section>

      <section className="advanced-filter-bar" aria-label="세부 필터">
        <label>
          프로젝트
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">전체 프로젝트</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          종류
          <select value={taskTypeId} onChange={(event) => setTaskTypeId(event.target.value)}>
            <option value="">전체 종류</option>
            {taskTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented-control" role="group" aria-label="일정 보기 방식">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={viewMode === mode.value ? "active" : ""}
              onClick={() => setViewMode(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-soft" onClick={resetFilters}>
          필터 초기화
        </button>
      </section>

      {viewMode === "LIST" ? (
        <div className="tasks-split-view">
          <section className="task-group-list" aria-label="일정 목록">
            {groupedTasks.length === 0 ? (
              <div className="empty-state">
                <h3>조건에 맞는 일정이 없습니다.</h3>
                <p>검색어와 필터를 줄이거나 새 일정을 추가하세요.</p>
                <button type="button" className="btn btn-primary" onClick={() => openCreatePanel(selectedDate)}>
                  새 일정
                </button>
              </div>
            ) : null}

            {groupedTasks.map((group) => (
              <section key={group.id} className="task-date-group">
                <header>
                  <h3>{group.title}</h3>
                  <span>{group.tasks.length}개</span>
                </header>
                {renderTaskList(group.tasks, "일정이 없습니다.")}
              </section>
            ))}
          </section>

          <TaskDetailPanel
            detailMode={detailMode}
            selectedTask={selectedTask}
            createFormKey={createFormKey}
            createDefaultDate={createDefaultDate}
            projects={projects}
            taskTypes={taskTypes}
            tasks={tasks}
            setting={setting}
            error={error}
            message={message}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onCancel={() => {
              setSelectedTaskId(null);
              setDetailMode("empty");
            }}
            onOpenCreate={() => openCreatePanel(selectedDate)}
          />
        </div>
      ) : null}

      {viewMode === "WEEK" ? (
        <div className="tasks-split-view">
          <section className="schedule-week-view" aria-label="주간 일정">
            <header className="schedule-view-header">
              <div>
                <p className="eyebrow">WEEK VIEW</p>
                <h3>
                  {getDateKey(weekDays[0].date)} - {getDateKey(weekDays[6].date)}
                </h3>
              </div>
              <div className="button-row">
                <button type="button" className="btn btn-soft" onClick={() => setSelectedDate(getDateKey(addDays(weekStart, -7)))}>
                  이전 주
                </button>
                <button type="button" className="btn btn-soft" onClick={() => setSelectedDate(getDateKey(new Date()))}>
                  오늘
                </button>
                <button type="button" className="btn btn-soft" onClick={() => setSelectedDate(getDateKey(addDays(weekStart, 7)))}>
                  다음 주
                </button>
              </div>
            </header>

            <div className="week-board">
              {weekDays.map((day) => (
                <section key={day.key} className={`week-column ${day.key === getDateKey(new Date()) ? "today" : ""}`}>
                  <header>
                    <strong>{formatDayLabel(day.date)}</strong>
                    <span>{day.tasks.length}개</span>
                  </header>
                  <button type="button" className="btn btn-soft week-add-button" onClick={() => openCreatePanel(day.key)}>
                    추가
                  </button>
                  <div className="week-task-list">
                    {day.tasks.length === 0 ? <p className="empty-text">일정 없음</p> : null}
                    {day.tasks.map((task) => (
                      <button key={task.id} type="button" className="week-task-card" onClick={() => openTask(task.id)}>
                        <strong>{task.title}</strong>
                        <small>{formatDateTime(task.startAt, setting.timeFormat)}</small>
                        {conflictMap[task.id]?.length ? <span>충돌</span> : null}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <TaskDetailPanel
            detailMode={detailMode}
            selectedTask={selectedTask}
            createFormKey={createFormKey}
            createDefaultDate={createDefaultDate}
            projects={projects}
            taskTypes={taskTypes}
            tasks={tasks}
            setting={setting}
            error={error}
            message={message}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onCancel={() => {
              setSelectedTaskId(null);
              setDetailMode("empty");
            }}
            onOpenCreate={() => openCreatePanel(selectedDate)}
          />
        </div>
      ) : null}

      {viewMode === "MONTH" ? (
        <div className="tasks-split-view">
          <section className="schedule-month-view">
            <MonthCalendar
              selectedDate={selectedDate}
              weekStartsOn={setting.weekStartsOn}
              daySummaryByDate={daySummaryByDate}
              onSelectDate={setSelectedDate}
              onDropTaskToDate={handleDropTaskToDate}
              onCreateTaskAtDate={(dateKey) => openCreatePanel(dateKey)}
            />
            {dropMessage ? <p className="success-text">{dropMessage}</p> : null}
            {dropError ? <p className="error-text">{dropError}</p> : null}
          </section>

          <aside className="task-detail-panel" aria-label="선택한 날짜 일정">
            <div className="detail-context">
              <span className="badge-pill">선택한 날짜</span>
              <strong>{selectedDate}</strong>
              <small>{(daySummaryByDate[selectedDate] ?? EMPTY_SUMMARY).total}개 일정</small>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => openCreatePanel(selectedDate)}>
              이 날짜에 일정 추가
            </button>
            {renderTaskList(selectedDateTasks, "선택한 날짜에 일정이 없습니다.")}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

interface TaskDetailPanelProps {
  detailMode: DetailMode;
  selectedTask?: Task;
  createFormKey: number;
  createDefaultDate?: string;
  projects: ReturnType<typeof useAppData>["projects"];
  taskTypes: ReturnType<typeof useAppData>["taskTypes"];
  tasks: Task[];
  setting: ReturnType<typeof useAppData>["setting"];
  error: string;
  message: string;
  onCreate: (input: TaskFormInput) => Promise<void>;
  onUpdate: (input: TaskFormInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
  onOpenCreate: () => void;
}

function TaskDetailPanel({
  detailMode,
  selectedTask,
  createFormKey,
  createDefaultDate,
  projects,
  taskTypes,
  tasks,
  setting,
  error,
  message,
  onCreate,
  onUpdate,
  onDelete,
  onCancel,
  onOpenCreate,
}: TaskDetailPanelProps) {
  return (
    <aside className="task-detail-panel" aria-label="일정 상세">
      {detailMode === "empty" ? (
        <div className="empty-state compact">
          <h3>일정을 선택하세요.</h3>
          <p>목록에서 일정을 선택하면 상세 정보와 편집 폼이 이곳에 표시됩니다.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenCreate}>
            새 일정 추가
          </button>
          {message ? <p className="success-text">{message}</p> : null}
        </div>
      ) : null}

      {detailMode === "create" ? (
        <TaskForm
          key={`new-task-${createFormKey}-${createDefaultDate ?? "today"}`}
          projects={projects}
          taskTypes={taskTypes}
          allTasks={tasks}
          defaultStartDate={createDefaultDate}
          timeFormat={setting.timeFormat}
          onSubmit={onCreate}
        />
      ) : null}

      {detailMode === "edit" && selectedTask ? (
        <>
          <div className="detail-context">
            <span className="badge-pill">선택한 일정</span>
            <strong>{selectedTask.title}</strong>
            <small>{formatDateTime(selectedTask.startAt, setting.timeFormat)}</small>
          </div>
          <TaskForm
            key={selectedTask.id}
            projects={projects}
            taskTypes={taskTypes}
            allTasks={tasks}
            initialTask={selectedTask}
            timeFormat={setting.timeFormat}
            onSubmit={onUpdate}
            onDelete={onDelete}
            onCancel={onCancel}
          />
        </>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {message && detailMode !== "empty" ? <p className="success-text">{message}</p> : null}
    </aside>
  );
}
