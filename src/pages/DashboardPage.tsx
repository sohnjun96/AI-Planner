import { useEffect, useMemo, useRef, useState } from "react";
import { AiAssistantWorkspace } from "../components/AiAssistantWorkspace";
import { type CalendarDaySummary, MonthCalendar } from "../components/MonthCalendar";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput } from "../models";
import { addDays, compareByStartAtAsc, formatDateTime, getDateKey, isPastCompletedHidden, shiftIsoToDateKey } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";

const GLOBAL_MEMO_KEY = "global";
const GLOBAL_MEMO_AUTOSAVE_DELAY_MS = 900;

type TaskModalState =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      taskId: string;
    }
  | null;

type DayFilter = "ALL" | "PENDING" | "DONE" | "ON_HOLD" | "MAJOR" | "CONFLICT";

const DAY_FILTER_OPTIONS: Array<{ value: DayFilter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "PENDING", label: "미완료" },
  { value: "DONE", label: "완료" },
  { value: "ON_HOLD", label: "보류" },
  { value: "MAJOR", label: "중요" },
  { value: "CONFLICT", label: "충돌" },
];

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

function matchesDayFilter(task: Task, filter: DayFilter, conflictCount: number): boolean {
  if (filter === "ALL") {
    return true;
  }
  if (filter === "PENDING") {
    return task.status !== "DONE";
  }
  if (filter === "DONE") {
    return task.status === "DONE";
  }
  if (filter === "ON_HOLD") {
    return task.status === "ON_HOLD";
  }
  if (filter === "MAJOR") {
    return task.isMajor;
  }
  return conflictCount > 0;
}

export function DashboardPage() {
  const { tasks, projects, taskTypes, memos, setting, createTask, updateTask, removeTask, saveMemo } = useAppData();
  const [selectedDate, setSelectedDate] = useState(() => getDateKey(new Date()));
  const [globalMemoDraft, setGlobalMemoDraft] = useState<string | null>(null);
  const [memoSaved, setMemoSaved] = useState("");
  const [memoError, setMemoError] = useState("");
  const [taskModalState, setTaskModalState] = useState<TaskModalState>(null);
  const [taskFormSerial, setTaskFormSerial] = useState(0);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dropMessage, setDropMessage] = useState("");
  const [dropError, setDropError] = useState("");
  const [dayFilter, setDayFilter] = useState<DayFilter>("ALL");
  const memoSnapshotRef = useRef("");

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted)),
    [tasks, setting.showPastCompleted],
  );

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const memoMap = useMemo(() => Object.fromEntries(memos.map((memo) => [memo.date, memo])), [memos]);
  const conflictMap = useMemo(() => buildTaskConflictMap(visibleTasks), [visibleTasks]);

  const daySummaryByDate = useMemo(() => {
    const map: Record<string, CalendarDaySummary> = {};

    for (const task of visibleTasks) {
      const key = getDateKey(task.startAt);
      if (!map[key]) {
        map[key] = {
          total: 0,
          done: 0,
          pending: 0,
          onHold: 0,
          conflicts: 0,
          major: 0,
          titles: [],
        };
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
  }, [visibleTasks, conflictMap]);

  const selectedDaySummary: CalendarDaySummary = daySummaryByDate[selectedDate] ?? {
    total: 0,
    done: 0,
    pending: 0,
    onHold: 0,
    conflicts: 0,
    major: 0,
    titles: [],
  };

  const dayTasks = useMemo(
    () =>
      visibleTasks
        .filter((task) => getDateKey(task.startAt) === selectedDate)
        .filter((task) => matchesDayFilter(task, dayFilter, conflictMap[task.id]?.length ?? 0))
        .sort(compareByStartAtAsc),
    [visibleTasks, selectedDate, dayFilter, conflictMap],
  );

  const majorTasks = useMemo(() => visibleTasks.filter((task) => task.isMajor).sort(compareByStartAtAsc).slice(0, 8), [visibleTasks]);

  const upcomingTasks = useMemo(() => {
    const todayStart = new Date(`${getDateKey(new Date())}T00:00:00`).getTime();
    const nextWeekEnd = addDays(new Date(), 7).getTime();

    return visibleTasks
      .filter((task) => task.status !== "DONE")
      .filter((task) => {
        const startAt = new Date(task.startAt).getTime();
        return Number.isFinite(startAt) && startAt >= todayStart && startAt <= nextWeekEnd;
      })
      .sort(compareByStartAtAsc)
      .slice(0, 10);
  }, [visibleTasks]);

  const briefing = useMemo(() => {
    const now = Date.now();
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0).getTime();
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).getTime();
    const weekEndDate = addDays(today, 6);
    const weekEnd = new Date(
      weekEndDate.getFullYear(),
      weekEndDate.getMonth(),
      weekEndDate.getDate(),
      23,
      59,
      59,
      999,
    ).getTime();

    const todayItems: Task[] = [];
    const weekItems: Task[] = [];
    let overdueCount = 0;

    for (const task of visibleTasks) {
      if (task.status === "DONE") {
        continue;
      }
      const startAt = new Date(task.startAt).getTime();
      if (!Number.isFinite(startAt)) {
        continue;
      }
      if (startAt < now) {
        overdueCount += 1;
      }
      if (startAt >= todayStart && startAt <= todayEnd) {
        todayItems.push(task);
      }
      if (startAt >= todayStart && startAt <= weekEnd) {
        weekItems.push(task);
      }
    }

    todayItems.sort(compareByStartAtAsc);
    weekItems.sort(compareByStartAtAsc);

    const conflictCount = visibleTasks.filter((task) => task.status !== "DONE" && (conflictMap[task.id]?.length ?? 0) > 0).length;

    return {
      todayItems: todayItems.slice(0, 5),
      weekItems: weekItems.slice(0, 7),
      todayCount: todayItems.length,
      weekCount: weekItems.length,
      overdueCount,
      conflictCount,
    };
  }, [visibleTasks, conflictMap]);

  const editingTask = useMemo(() => {
    if (!taskModalState || taskModalState.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);

  const activeTaskModalState: TaskModalState = taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;

  const globalMemoSource = memoMap[GLOBAL_MEMO_KEY]?.content ?? "";
  const globalMemoContent = globalMemoDraft ?? globalMemoSource;

  useEffect(() => {
    memoSnapshotRef.current = globalMemoSource.trim();
  }, [globalMemoSource]);

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

  useEffect(() => {
    if (globalMemoDraft === null) {
      return;
    }
    const normalized = globalMemoDraft.trim();
    if (normalized === memoSnapshotRef.current) {
      return;
    }
    const timerId = window.setTimeout(() => {
      void saveMemo(GLOBAL_MEMO_KEY, globalMemoDraft)
        .then(() => {
          memoSnapshotRef.current = normalized;
          setMemoSaved("자동 저장됨");
        })
        .catch((saveError) => {
          setMemoError(saveError instanceof Error ? saveError.message : "메모 저장에 실패했습니다.");
        });
    }, GLOBAL_MEMO_AUTOSAVE_DELAY_MS);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [globalMemoDraft, saveMemo]);

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
    } finally {
      setDraggingTaskId(null);
    }
  }

  async function handleSaveGlobalMemo() {
    setMemoError("");
    try {
      await saveMemo(GLOBAL_MEMO_KEY, globalMemoContent);
      memoSnapshotRef.current = globalMemoContent.trim();
      setMemoSaved("저장 완료");
    } catch (saveError) {
      setMemoError(saveError instanceof Error ? saveError.message : "메모 저장에 실패했습니다.");
    }
  }

  function openCreateTaskForDate(dateKey: string) {
    setSelectedDate(dateKey);
    setTaskFormSerial((prev) => prev + 1);
    setTaskModalState({ mode: "create" });
  }

  return (
    <div className="dashboard-page">
      <AiAssistantWorkspace compact showEndpointInfo={false} />

      <section className="panel briefing-panel">
        <header className="panel-header">
          <h2>오늘/주간 브리핑</h2>
          <small>
            오늘 {briefing.todayCount}건 | 이번 주 {briefing.weekCount}건
          </small>
        </header>

        <div className="kpi-grid">
          <article className="kpi-card accent">
            <small>오늘 남은 일정</small>
            <strong>{briefing.todayCount}</strong>
          </article>
          <article className="kpi-card">
            <small>이번 주 남은 일정</small>
            <strong>{briefing.weekCount}</strong>
          </article>
          <article className="kpi-card danger">
            <small>지연 위험</small>
            <strong>{briefing.overdueCount}</strong>
          </article>
          <article className="kpi-card danger">
            <small>충돌 일정</small>
            <strong>{briefing.conflictCount}</strong>
          </article>
          <article className="kpi-card">
            <small>선택 날짜</small>
            <strong>{selectedDaySummary.total}</strong>
          </article>
        </div>

        <div className="briefing-grid">
          <article className="briefing-card">
            <h3>오늘 우선순위</h3>
            {briefing.todayItems.length === 0 ? <p className="empty-text">오늘 남은 일정이 없습니다.</p> : null}
            <ul className="mini-list">
              {briefing.todayItems.map((task) => (
                <li key={`briefing-today-${task.id}`}>
                  {task.title} ({formatDateTime(task.startAt, setting.timeFormat)})
                </li>
              ))}
            </ul>
          </article>

          <article className="briefing-card">
            <h3>이번 주 주요 일정</h3>
            {briefing.weekItems.length === 0 ? <p className="empty-text">이번 주 일정이 없습니다.</p> : null}
            <ul className="mini-list">
              {briefing.weekItems.map((task) => (
                <li key={`briefing-week-${task.id}`}>
                  {task.title} ({getDateKey(task.startAt)})
                </li>
              ))}
            </ul>
          </article>

          <article className="briefing-card metrics">
            <h3>운영 상태</h3>
            <p>선택 날짜 미완료: {selectedDaySummary.pending}건</p>
            <p>선택 날짜 완료: {selectedDaySummary.done}건</p>
            <p>선택 날짜 충돌: {selectedDaySummary.conflicts}건</p>
            {draggingTaskId ? <p className="description-text">드래그 중입니다. 날짜 칸에 놓아 일정을 재배치하세요.</p> : null}
          </article>
        </div>

        {dropMessage ? <p className="success-text">{dropMessage}</p> : null}
        {dropError ? <p className="error-text">{dropError}</p> : null}
      </section>

      <section className="panel global-memo-panel">
        <header className="panel-header">
          <h2>전체 메모</h2>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void handleSaveGlobalMemo();
            }}
          >
            메모 저장
          </button>
        </header>
        <textarea
          value={globalMemoContent}
          onChange={(event) => {
            setMemoSaved("");
            setMemoError("");
            setGlobalMemoDraft(event.target.value);
          }}
          rows={4}
          placeholder="전체 일정 공유 메모를 작성하세요."
        />
        {memoSaved ? <p className="success-text">{memoSaved}</p> : null}
        {memoError ? <p className="error-text">{memoError}</p> : null}
      </section>

      <div className="dashboard-grid">
        <MonthCalendar
          selectedDate={selectedDate}
          weekStartsOn={setting.weekStartsOn}
          daySummaryByDate={daySummaryByDate}
          onSelectDate={setSelectedDate}
          onDropTaskToDate={handleDropTaskToDate}
          onCreateTaskAtDate={openCreateTaskForDate}
        />

        <section className="panel">
          <header className="panel-header">
            <h2>날짜별 일정</h2>
            <div className="panel-header-actions">
              <small>
                {selectedDate} · 총 {selectedDaySummary.total}건
              </small>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  openCreateTaskForDate(selectedDate);
                }}
              >
                일정 추가
              </button>
            </div>
          </header>

          <div className="button-row">
            {DAY_FILTER_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`btn btn-soft ${dayFilter === option.value ? "is-active" : ""}`}
                onClick={() => setDayFilter(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="task-stack">
            {dayTasks.length === 0 ? <p className="empty-text">조건에 맞는 일정이 없습니다.</p> : null}
            {dayTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                project={projectMap[task.projectId]}
                taskType={typeMap[task.taskTypeId]}
                timeFormat={setting.timeFormat}
                hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
                draggableTask
                onDragTaskStateChange={setDraggingTaskId}
                onClick={() => {
                  setTaskModalState({ mode: "edit", taskId: task.id });
                }}
              />
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="panel-header">
            <h2>중요/다가오는 일정</h2>
          </header>

          <div className="mini-list-block">
            <h3>중요 일정</h3>
            <div className="task-stack">
              {majorTasks.length === 0 ? <p className="empty-text">중요 일정이 없습니다.</p> : null}
              {majorTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  project={projectMap[task.projectId]}
                  taskType={typeMap[task.taskTypeId]}
                  timeFormat={setting.timeFormat}
                  hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
                  draggableTask
                  onDragTaskStateChange={setDraggingTaskId}
                  onClick={() => {
                    setTaskModalState({ mode: "edit", taskId: task.id });
                  }}
                />
              ))}
            </div>
          </div>

          <div className="mini-list-block">
            <h3>다가오는 7일</h3>
            {upcomingTasks.length === 0 ? <p className="empty-text">다가오는 일정이 없습니다.</p> : null}
            <ul className="mini-list">
              {upcomingTasks.map((task) => (
                <li key={`upcoming-${task.id}`}>
                  {task.title} ({formatDateTime(task.startAt, setting.timeFormat)})
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

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
            aria-label="일정 상세/수정"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>{activeTaskModalState.mode === "create" ? "일정 추가" : "일정 수정"}</h2>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setTaskModalState(null);
                }}
              >
                닫기
              </button>
            </header>

            {activeTaskModalState.mode === "create" ? (
              <TaskForm
                key={`dashboard-new-task-${selectedDate}-${taskFormSerial}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                defaultStartDate={selectedDate}
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
                onCancel={() => {
                  setTaskModalState(null);
                }}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
