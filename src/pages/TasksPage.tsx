import { useEffect, useMemo, useState } from "react";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";
import { addDays, compareByStartAtAsc, formatDateTime, getDateKey, isPastCompletedHidden } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";

type QuickFilter = "ALL" | "TODAY" | "WEEK" | "PENDING" | "CONFLICT" | "MAJOR";
type DetailMode = "empty" | "create" | "edit";

const QUICK_FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "TODAY", label: "오늘" },
  { value: "WEEK", label: "이번 주" },
  { value: "PENDING", label: "미완료" },
  { value: "CONFLICT", label: "충돌" },
  { value: "MAJOR", label: "중요" },
];

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

export function TasksPage() {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask } = useAppData();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [keyword, setKeyword] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("ALL");
  const [projectId, setProjectId] = useState("");
  const [taskTypeId, setTaskTypeId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<DetailMode>("empty");
  const [createFormKey, setCreateFormKey] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  function openCreatePanel() {
    setError("");
    setMessage("");
    setSelectedTaskId(null);
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

  function resetFilters() {
    setKeyword("");
    setQuickFilter("ALL");
    setProjectId("");
    setTaskTypeId("");
  }

  return (
    <div className="tasks-workspace">
      <section className="tasks-overview">
        <div>
          <p className="eyebrow">TASKS</p>
          <h2>일정</h2>
          <p className="description-text">모든 일정을 찾고, 상태를 확인하고, 필요한 항목만 빠르게 수정합니다.</p>
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
        <button type="button" className="btn btn-primary" onClick={openCreatePanel}>
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
        <button type="button" className="btn btn-soft" onClick={resetFilters}>
          필터 초기화
        </button>
      </section>

      <div className="tasks-split-view">
        <section className="task-group-list" aria-label="일정 목록">
          {groupedTasks.length === 0 ? (
            <div className="empty-state">
              <h3>조건에 맞는 일정이 없습니다.</h3>
              <p>검색어와 필터를 줄이거나 새 일정을 추가하세요.</p>
              <button type="button" className="btn btn-primary" onClick={openCreatePanel}>
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
              <div className="task-stack">
                {group.tasks.map((task) => (
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
            </section>
          ))}
        </section>

        <aside className="task-detail-panel" aria-label="일정 상세">
          {detailMode === "empty" ? (
            <div className="empty-state compact">
              <h3>일정을 선택하세요.</h3>
              <p>목록에서 일정을 선택하면 상세 정보와 편집 폼이 이곳에 표시됩니다.</p>
              <button type="button" className="btn btn-primary" onClick={openCreatePanel}>
                새 일정 추가
              </button>
              {message ? <p className="success-text">{message}</p> : null}
            </div>
          ) : null}

          {detailMode === "create" ? (
            <TaskForm
              key={`new-task-${createFormKey}`}
              projects={projects}
              taskTypes={taskTypes}
              allTasks={tasks}
              timeFormat={setting.timeFormat}
              onSubmit={handleCreate}
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
                onSubmit={handleUpdate}
                onDelete={handleDelete}
                onCancel={() => {
                  setSelectedTaskId(null);
                  setDetailMode("empty");
                }}
              />
            </>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
          {message && detailMode !== "empty" ? <p className="success-text">{message}</p> : null}
        </aside>
      </div>
    </div>
  );
}
