import { useMemo, useState } from "react";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";
import { isPastCompletedHidden } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";

type TaskSortKey = "priority" | "startAt" | "completedAt";
type SortDirection = "asc" | "desc";

interface SortState {
  keyword: string;
  sortBy: TaskSortKey;
  direction: SortDirection;
}

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

function compareBySortRule(a: Task, b: Task, sortBy: TaskSortKey, direction: SortDirection): number {
  const startDiff = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();

  if (sortBy === "priority") {
    const priorityDiff = Number(a.isMajor) - Number(b.isMajor);
    if (priorityDiff !== 0) {
      return direction === "asc" ? priorityDiff : -priorityDiff;
    }
    return direction === "asc" ? startDiff : -startDiff;
  }

  if (sortBy === "startAt") {
    return direction === "asc" ? startDiff : -startDiff;
  }

  const completedA = a.completedAt ? new Date(a.completedAt).getTime() : null;
  const completedB = b.completedAt ? new Date(b.completedAt).getTime() : null;

  if (completedA === null && completedB === null) {
    return direction === "asc" ? startDiff : -startDiff;
  }
  if (completedA === null) {
    return 1;
  }
  if (completedB === null) {
    return -1;
  }

  const completedDiff = completedA - completedB;
  return direction === "asc" ? completedDiff : -completedDiff;
}

export function TasksPage() {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask } = useAppData();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [sortState, setSortState] = useState<SortState>({
    keyword: "",
    sortBy: "priority",
    direction: "desc",
  });
  const [error, setError] = useState("");

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const conflictMap = useMemo(() => buildTaskConflictMap(tasks), [tasks]);

  const sortedTasks = useMemo(() => {
    return tasks
      .filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted))
      .filter((task) => {
        if (!sortState.keyword.trim()) {
          return true;
        }
        const keyword = sortState.keyword.trim().toLowerCase();
        const projectName = projectMap[task.projectId]?.name ?? "";
        const typeName = typeMap[task.taskTypeId]?.name ?? "";
        return `${task.title} ${task.content} ${projectName} ${typeName}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => compareBySortRule(a, b, sortState.sortBy, sortState.direction));
  }, [tasks, setting.showPastCompleted, sortState, projectMap, typeMap]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [selectedTaskId, tasks]);

  const conflictTasks = useMemo(
    () => sortedTasks.filter((task) => (conflictMap[task.id]?.length ?? 0) > 0).slice(0, 8),
    [sortedTasks, conflictMap],
  );

  async function handleCreate(input: TaskFormInput) {
    setError("");
    await createTask(input);
  }

  async function handleUpdate(input: TaskFormInput) {
    if (!selectedTaskId) {
      return;
    }
    setError("");
    await updateTask(selectedTaskId, input);
  }

  async function handleDelete() {
    if (!selectedTaskId) {
      return;
    }
    setError("");
    await removeTask(selectedTaskId);
    setSelectedTaskId(null);
  }

  return (
    <div className="tasks-layout">
      <section className="panel filter-panel">
        <h2>정렬</h2>

        <label>
          검색
          <input
            type="text"
            value={sortState.keyword}
            onChange={(event) => setSortState((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="제목/내용/프로젝트/종류 검색"
          />
        </label>

        <label>
          정렬 기준
          <select
            value={sortState.sortBy}
            onChange={(event) => setSortState((prev) => ({ ...prev, sortBy: event.target.value as TaskSortKey }))}
          >
            <option value="priority">중요도</option>
            <option value="startAt">시작 시간</option>
            <option value="completedAt">완료 시간</option>
          </select>
        </label>

        <label>
          순서
          <select
            value={sortState.direction}
            onChange={(event) => setSortState((prev) => ({ ...prev, direction: event.target.value as SortDirection }))}
          >
            <option value="desc">내림차순</option>
            <option value="asc">오름차순</option>
          </select>
        </label>

        <button
          type="button"
          className="btn btn-soft"
          onClick={() =>
            setSortState({
              keyword: "",
              sortBy: "priority",
              direction: "desc",
            })
          }
        >
          초기화
        </button>

        <section className="mini-list-block" aria-label="충돌 일정 요약">
          <h3>충돌 일정</h3>
          {conflictTasks.length === 0 ? <p className="empty-text">충돌이 없습니다.</p> : null}
          <ul className="mini-list">
            {conflictTasks.map((task) => (
              <li key={`conflict-${task.id}`}>
                {task.title} ({conflictMap[task.id]?.length ?? 0}건)
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>일정 목록</h2>
          <small>{sortedTasks.length}개</small>
        </header>
        <div className="task-stack">
          {sortedTasks.length === 0 ? <p className="empty-text">등록된 일정이 없습니다.</p> : null}
          {sortedTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              project={projectMap[task.projectId]}
              taskType={typeMap[task.taskTypeId]}
              timeFormat={setting.timeFormat}
              selected={selectedTaskId === task.id}
              hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
              onClick={() => setSelectedTaskId(task.id)}
              onStatusChange={(status) => {
                void updateTask(task.id, toTaskInput(task, status)).catch((updateError) => {
                  setError(updateError instanceof Error ? updateError.message : "상태 변경에 실패했습니다.");
                });
              }}
            />
          ))}
        </div>
      </section>

      <section className="panel">
        {selectedTask ? (
          <TaskForm
            key={selectedTask.id}
            projects={projects}
            taskTypes={taskTypes}
            allTasks={tasks}
            initialTask={selectedTask}
            timeFormat={setting.timeFormat}
            onSubmit={handleUpdate}
            onDelete={handleDelete}
            onCancel={() => setSelectedTaskId(null)}
          />
        ) : (
          <TaskForm
            key="new-task-form"
            projects={projects}
            taskTypes={taskTypes}
            allTasks={tasks}
            timeFormat={setting.timeFormat}
            onSubmit={handleCreate}
          />
        )}
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </div>
  );
}
