import { useEffect, useMemo, useRef, useState } from "react";
import { MonthCalendar } from "../components/MonthCalendar";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput } from "../models";
import { compareByStartAtAsc, getDateKey, isPastCompletedHidden } from "../utils/date";

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

function isEventTask(task: Task, taskTypeName: string | undefined): boolean {
  if (task.taskTypeId === "type-event") {
    return true;
  }
  const normalized = (taskTypeName ?? "").replace(/\s+/g, "");
  return normalized.includes("행사");
}

export function DashboardPage() {
  const { tasks, projects, taskTypes, memos, setting, createTask, updateTask, removeTask, saveMemo } = useAppData();
  const [selectedDate, setSelectedDate] = useState(() => getDateKey(new Date()));
  const [globalMemoDraft, setGlobalMemoDraft] = useState<string | null>(null);
  const [memoSaved, setMemoSaved] = useState<string>("");
  const [memoError, setMemoError] = useState<string>("");
  const [taskModalState, setTaskModalState] = useState<TaskModalState>(null);
  const [taskFormSerial, setTaskFormSerial] = useState(0);
  const memoSnapshotRef = useRef("");

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted)),
    [tasks, setting.showPastCompleted],
  );

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const memoMap = useMemo(() => Object.fromEntries(memos.map((memo) => [memo.date, memo])), [memos]);

  const taskCountByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const task of tasks) {
      const key = getDateKey(task.startAt);
      map[key] = (map[key] ?? 0) + 1;
    }
    return map;
  }, [tasks]);

  const eventTitlesByDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const task of tasks) {
      const taskTypeName = typeMap[task.taskTypeId]?.name;
      if (!isEventTask(task, taskTypeName)) {
        continue;
      }
      const key = getDateKey(task.startAt);
      if (!map[key]) {
        map[key] = [];
      }
      map[key].push(task.title);
    }

    for (const key of Object.keys(map)) {
      map[key] = map[key].slice(0, 3);
    }

    return map;
  }, [tasks, typeMap]);

  const dayTasks = useMemo(
    () => visibleTasks.filter((task) => getDateKey(task.startAt) === selectedDate).sort(compareByStartAtAsc),
    [visibleTasks, selectedDate],
  );

  const majorTasks = useMemo(
    () => visibleTasks.filter((task) => task.isMajor).sort(compareByStartAtAsc).slice(0, 8),
    [visibleTasks],
  );

  const editingTask = useMemo(() => {
    if (!taskModalState || taskModalState.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);

  const activeTaskModalState: TaskModalState =
    taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;

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
          setMemoSaved("자동 저장됨.");
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

  async function handleSaveGlobalMemo() {
    setMemoError("");
    try {
      await saveMemo(GLOBAL_MEMO_KEY, globalMemoContent);
      memoSnapshotRef.current = globalMemoContent.trim();
      setMemoSaved("저장됨.");
    } catch (saveError) {
      setMemoError(saveError instanceof Error ? saveError.message : "메모 저장에 실패했습니다.");
    }
  }

  return (
    <div className="dashboard-page">
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
          placeholder="전체 일정에 대한 메모를 작성하세요."
        />
        {memoSaved ? <p className="success-text">{memoSaved}</p> : null}
        {memoError ? <p className="error-text">{memoError}</p> : null}
      </section>

      <div className="dashboard-grid">
        <MonthCalendar
          selectedDate={selectedDate}
          weekStartsOn={setting.weekStartsOn}
          taskCountByDate={taskCountByDate}
          eventTitlesByDate={eventTitlesByDate}
          onSelectDate={setSelectedDate}
        />

        <section className="panel">
          <header className="panel-header">
            <h2>날짜별 일정</h2>
            <div className="panel-header-actions">
              <small>{selectedDate}</small>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setTaskFormSerial((prev) => prev + 1);
                  setTaskModalState({ mode: "create" });
                }}
              >
                일정 추가
              </button>
            </div>
          </header>
          <div className="task-stack">
            {dayTasks.length === 0 ? <p className="empty-text">해당 날짜 일정이 없습니다.</p> : null}
            {dayTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                project={projectMap[task.projectId]}
                taskType={typeMap[task.taskTypeId]}
                timeFormat={setting.timeFormat}
                onClick={() => {
                  setTaskModalState({ mode: "edit", taskId: task.id });
                }}
              />
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="panel-header">
            <h2>주요 일정</h2>
          </header>
          <div className="task-stack">
            {majorTasks.length === 0 ? <p className="empty-text">주요 일정이 없습니다.</p> : null}
            {majorTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                project={projectMap[task.projectId]}
                taskType={typeMap[task.taskTypeId]}
                timeFormat={setting.timeFormat}
                onClick={() => {
                  setTaskModalState({ mode: "edit", taskId: task.id });
                }}
              />
            ))}
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
            aria-label="일정 대화상자"
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
                defaultStartDate={selectedDate}
                timeFormat={setting.timeFormat}
                onSubmit={handleCreateTask}
              />
            ) : editingTask ? (
              <TaskForm
                key={`dashboard-edit-task-${editingTask.id}`}
                projects={projects}
                taskTypes={taskTypes}
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

