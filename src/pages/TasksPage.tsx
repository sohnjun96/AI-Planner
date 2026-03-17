import { useEffect, useMemo, useState } from "react";
import { STATUS_LABELS } from "../constants";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";
import { isPastCompletedHidden, toIsoNow } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";

type TaskSortKey = "priority" | "startAt" | "completedAt";
type SortDirection = "asc" | "desc";

interface SortState {
  keyword: string;
  sortBy: TaskSortKey;
  direction: SortDirection;
}

interface TaskFilterState {
  projectId: string;
  taskTypeId: string;
  status: TaskStatus | "";
  fromDate: string;
  toDate: string;
  majorOnly: boolean;
  conflictOnly: boolean;
}

interface SavedTaskView {
  id: string;
  name: string;
  sortState: SortState;
  filterState: TaskFilterState;
  updatedAt: string;
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

const TASK_VIEW_STORAGE_KEY = "tasks_saved_views_v1";

function normalizeSortState(value: unknown): SortState {
  const fallback: SortState = {
    keyword: "",
    sortBy: "priority",
    direction: "desc",
  };
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const candidate = value as Partial<SortState>;
  const sortBy = candidate.sortBy === "startAt" || candidate.sortBy === "completedAt" || candidate.sortBy === "priority"
    ? candidate.sortBy
    : fallback.sortBy;
  const direction = candidate.direction === "asc" || candidate.direction === "desc" ? candidate.direction : fallback.direction;
  const keyword = typeof candidate.keyword === "string" ? candidate.keyword : fallback.keyword;
  return { keyword, sortBy, direction };
}

const DEFAULT_TASK_FILTER_STATE: TaskFilterState = {
  projectId: "",
  taskTypeId: "",
  status: "",
  fromDate: "",
  toDate: "",
  majorOnly: false,
  conflictOnly: false,
};

function normalizeTaskFilterState(value: unknown): TaskFilterState {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_TASK_FILTER_STATE };
  }
  const candidate = value as Partial<TaskFilterState>;
  return {
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : "",
    taskTypeId: typeof candidate.taskTypeId === "string" ? candidate.taskTypeId : "",
    status: candidate.status === "NOT_DONE" || candidate.status === "ON_HOLD" || candidate.status === "DONE" ? candidate.status : "",
    fromDate: typeof candidate.fromDate === "string" ? candidate.fromDate : "",
    toDate: typeof candidate.toDate === "string" ? candidate.toDate : "",
    majorOnly: Boolean(candidate.majorOnly),
    conflictOnly: Boolean(candidate.conflictOnly),
  };
}

function escapeCsvValue(value: unknown): string {
  const normalized = `${value ?? ""}`;
  if (!/[",\r\n]/.test(normalized)) {
    return normalized;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

function readSavedTaskViews(): SavedTaskView[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(TASK_VIEW_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as SavedTaskView).id === "string" &&
          typeof (item as SavedTaskView).name === "string",
      )
      .map((item) => {
        const candidate = item as Partial<SavedTaskView>;
        return {
          id: candidate.id ?? "",
          name: candidate.name ?? "",
          sortState: normalizeSortState(candidate.sortState),
          filterState: normalizeTaskFilterState(candidate.filterState),
          updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
        };
      });
  } catch {
    return [];
  }
}

function writeSavedTaskViews(views: SavedTaskView[]) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(TASK_VIEW_STORAGE_KEY, JSON.stringify(views));
}

function getTaskViewId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `view-${crypto.randomUUID()}`;
  }
  return `view-${Math.random().toString(36).slice(2, 10)}`;
}

export function TasksPage() {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask } = useAppData();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [sortState, setSortState] = useState<SortState>({
    keyword: "",
    sortBy: "priority",
    direction: "desc",
  });
  const [error, setError] = useState("");
  const [savedViews, setSavedViews] = useState<SavedTaskView[]>(() => readSavedTaskViews());
  const [viewName, setViewName] = useState("");
  const [viewMessage, setViewMessage] = useState("");
  const [filterState, setFilterState] = useState<TaskFilterState>(() => ({ ...DEFAULT_TASK_FILTER_STATE }));
  const [selectedTaskIdsForBulk, setSelectedTaskIdsForBulk] = useState<string[]>([]);
  const [bulkMessage, setBulkMessage] = useState("");

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const conflictMap = useMemo(() => buildTaskConflictMap(tasks), [tasks]);

  const sortedTasks = useMemo(() => {
    return tasks
      .filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted))
      .filter((task) => {
        if (filterState.projectId && task.projectId !== filterState.projectId) {
          return false;
        }
        if (filterState.taskTypeId && task.taskTypeId !== filterState.taskTypeId) {
          return false;
        }
        if (filterState.status && task.status !== filterState.status) {
          return false;
        }
        if (filterState.majorOnly && !task.isMajor) {
          return false;
        }
        if (filterState.conflictOnly && (conflictMap[task.id]?.length ?? 0) === 0) {
          return false;
        }
        const taskTime = new Date(task.startAt).getTime();
        if (filterState.fromDate && taskTime < new Date(`${filterState.fromDate}T00:00:00`).getTime()) {
          return false;
        }
        if (filterState.toDate && taskTime > new Date(`${filterState.toDate}T23:59:59`).getTime()) {
          return false;
        }
        if (!sortState.keyword.trim()) {
          return true;
        }
        const keyword = sortState.keyword.trim().toLowerCase();
        const projectName = projectMap[task.projectId]?.name ?? "";
        const typeName = typeMap[task.taskTypeId]?.name ?? "";
        return `${task.title} ${task.content} ${projectName} ${typeName}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => compareBySortRule(a, b, sortState.sortBy, sortState.direction));
  }, [tasks, setting.showPastCompleted, sortState, filterState, projectMap, typeMap, conflictMap]);

  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [selectedTaskId, tasks]);
  const selectedTaskSet = useMemo(() => new Set(selectedTaskIdsForBulk), [selectedTaskIdsForBulk]);

  const conflictTasks = useMemo(
    () => sortedTasks.filter((task) => (conflictMap[task.id]?.length ?? 0) > 0).slice(0, 8),
    [sortedTasks, conflictMap],
  );

  const taskStats = useMemo(() => {
    const total = sortedTasks.length;
    const done = sortedTasks.filter((task) => task.status === "DONE").length;
    const onHold = sortedTasks.filter((task) => task.status === "ON_HOLD").length;
    const overdue = sortedTasks.filter((task) => task.status !== "DONE" && new Date(task.startAt).getTime() < currentTime).length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, onHold, overdue, completionRate };
  }, [sortedTasks, currentTime]);

  const bulkTargetTasks = useMemo(() => sortedTasks.filter((task) => selectedTaskSet.has(task.id)), [sortedTasks, selectedTaskSet]);

  useEffect(() => {
    writeSavedTaskViews(savedViews);
  }, [savedViews]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000);
    return () => {
      window.clearInterval(timerId);
    };
  }, []);

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

  function handleSaveCurrentView() {
    const name = viewName.trim();
    if (!name) {
      setError("뷰 이름을 입력해 주세요.");
      return;
    }
    setError("");
    const now = toIsoNow();
    setSavedViews((prev) => {
      const existingIndex = prev.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
      const entry: SavedTaskView = {
        id: existingIndex >= 0 ? prev[existingIndex].id : getTaskViewId(),
        name,
        sortState: normalizeSortState(sortState),
        filterState: normalizeTaskFilterState(filterState),
        updatedAt: now,
      };
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = entry;
        return next;
      }
      return [entry, ...prev].slice(0, 20);
    });
    setViewName("");
    setViewMessage(`저장됨: ${name}`);
  }

  function handleApplyView(view: SavedTaskView) {
    setSortState(normalizeSortState(view.sortState));
    setFilterState(normalizeTaskFilterState(view.filterState));
    setViewMessage(`적용됨: ${view.name}`);
  }

  function handleDeleteView(viewId: string) {
    setSavedViews((prev) => prev.filter((item) => item.id !== viewId));
    setViewMessage("저장된 뷰가 삭제되었습니다.");
  }

  function handleToggleTaskSelection(taskId: string, checked: boolean) {
    setSelectedTaskIdsForBulk((prev) => {
      if (checked) {
        if (prev.includes(taskId)) {
          return prev;
        }
        return [...prev, taskId];
      }
      return prev.filter((id) => id !== taskId);
    });
  }

  async function handleBulkStatusChange(status: TaskStatus) {
    if (bulkTargetTasks.length === 0) {
      setError("상태변경할 일정을 먼저 선택해 주세요.");
      return;
    }
    setError("");
    setBulkMessage("");
    let successCount = 0;
    const failedTitles: string[] = [];
    for (const task of bulkTargetTasks) {
      try {
        await updateTask(task.id, toTaskInput(task, status));
        successCount += 1;
      } catch {
        failedTitles.push(task.title);
      }
    }
    setBulkMessage(`상태 변경 완료: ${successCount}건`);
    if (failedTitles.length > 0) {
      setError(`실패 ${failedTitles.length}건: ${failedTitles.slice(0, 3).join(", ")}`);
    }
    setSelectedTaskIdsForBulk([]);
  }

  async function handleBulkDelete() {
    if (bulkTargetTasks.length === 0) {
      setError("삭제할 일정을 먼저 선택해 주세요.");
      return;
    }
    const shouldDelete = window.confirm(`선택한 ${bulkTargetTasks.length}개 일정을 삭제할까요?`);
    if (!shouldDelete) {
      return;
    }
    setError("");
    setBulkMessage("");
    let successCount = 0;
    const failedTitles: string[] = [];
    for (const task of bulkTargetTasks) {
      try {
        await removeTask(task.id);
        successCount += 1;
      } catch {
        failedTitles.push(task.title);
      }
    }
    setBulkMessage(`삭제 완료: ${successCount}건`);
    if (failedTitles.length > 0) {
      setError(`삭제 실패 ${failedTitles.length}건: ${failedTitles.slice(0, 3).join(", ")}`);
    }
    setSelectedTaskIdsForBulk([]);
  }

  function handleExportCsv(onlySelected = false) {
    const source = onlySelected ? bulkTargetTasks : sortedTasks;
    if (source.length === 0) {
      setError("내보낼 일정이 없습니다.");
      return;
    }
    const header = ["title", "content", "project", "taskType", "status", "startAt", "endAt", "isMajor"];
    const rows = source.map((task) =>
      [
        task.title,
        task.content,
        projectMap[task.projectId]?.name ?? task.projectId,
        typeMap[task.taskTypeId]?.name ?? task.taskTypeId,
        task.status,
        task.startAt,
        task.endAt ?? "",
        task.isMajor ? "Y" : "N",
      ]
        .map(escapeCsvValue)
        .join(","),
    );
    const csv = [header.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setBulkMessage(`CSV 내보내기 완료: ${source.length}건`);
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

        <label>
          Project
          <select
            value={filterState.projectId}
            onChange={(event) => setFilterState((prev) => ({ ...prev, projectId: event.target.value }))}
          >
            <option value="">All</option>
            {projects.map((project) => (
              <option key={`filter-project-${project.id}`} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Task Type
          <select
            value={filterState.taskTypeId}
            onChange={(event) => setFilterState((prev) => ({ ...prev, taskTypeId: event.target.value }))}
          >
            <option value="">All</option>
            {taskTypes.map((type) => (
              <option key={`filter-type-${type.id}`} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Status
          <select
            value={filterState.status}
            onChange={(event) =>
              setFilterState((prev) => ({
                ...prev,
                status:
                  event.target.value === "NOT_DONE" || event.target.value === "ON_HOLD" || event.target.value === "DONE"
                    ? event.target.value
                    : "",
              }))
            }
          >
            <option value="">All</option>
            <option value="NOT_DONE">{STATUS_LABELS.NOT_DONE}</option>
            <option value="ON_HOLD">{STATUS_LABELS.ON_HOLD}</option>
            <option value="DONE">{STATUS_LABELS.DONE}</option>
          </select>
        </label>

        <div className="form-grid two-col">
          <label>
            From
            <input
              type="date"
              value={filterState.fromDate}
              onChange={(event) => setFilterState((prev) => ({ ...prev, fromDate: event.target.value }))}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filterState.toDate}
              onChange={(event) => setFilterState((prev) => ({ ...prev, toDate: event.target.value }))}
            />
          </label>
        </div>

        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={filterState.majorOnly}
            onChange={(event) => setFilterState((prev) => ({ ...prev, majorOnly: event.target.checked }))}
          />
          Major only
        </label>

        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={filterState.conflictOnly}
            onChange={(event) => setFilterState((prev) => ({ ...prev, conflictOnly: event.target.checked }))}
          />
          Conflict only
        </label>

        <button
          type="button"
          className="btn btn-soft"
          onClick={() => {
            setSortState({
              keyword: "",
              sortBy: "priority",
              direction: "desc",
            });
            setFilterState({ ...DEFAULT_TASK_FILTER_STATE });
            setSelectedTaskIdsForBulk([]);
            setBulkMessage("");
          }}
        >
          초기화
        </button>

        <section className="mini-list-block" aria-label="저장한 뷰">
          <h3>저장 뷰</h3>
          <label>
            뷰 이름
            <input type="text" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="예: 오늘 집중" />
          </label>
          <button type="button" className="btn btn-soft" onClick={handleSaveCurrentView}>
            현재 필터 저장
          </button>
          {viewMessage ? <p className="success-text">{viewMessage}</p> : null}
          {savedViews.length === 0 ? <p className="empty-text">저장한 뷰가 없습니다.</p> : null}
          <ul className="mini-list saved-view-list">
            {savedViews.map((view) => (
              <li key={view.id} className="saved-view-item">
                <span>{view.name}</span>
                <div className="button-row compact">
                  <button type="button" className="btn btn-soft" onClick={() => handleApplyView(view)}>
                    적용
                  </button>
                  <button type="button" className="btn btn-danger" onClick={() => handleDeleteView(view.id)}>
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

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

        <div className="kpi-grid">
          <article className="kpi-card">
            <strong>{taskStats.total}</strong>
            <small>Visible</small>
          </article>
          <article className="kpi-card">
            <strong>{taskStats.done}</strong>
            <small>Done</small>
          </article>
          <article className="kpi-card">
            <strong>{taskStats.onHold}</strong>
            <small>On hold</small>
          </article>
          <article className="kpi-card danger">
            <strong>{taskStats.overdue}</strong>
            <small>Overdue</small>
          </article>
          <article className="kpi-card accent">
            <strong>{taskStats.completionRate}%</strong>
            <small>Completion</small>
          </article>
        </div>

        <section className="bulk-toolbar">
          <p className="description-text">Bulk selected: {bulkTargetTasks.length}</p>
          <div className="button-row">
            <button type="button" className="btn btn-soft" onClick={() => setSelectedTaskIdsForBulk(sortedTasks.map((task) => task.id))}>
              Select all
            </button>
            <button type="button" className="btn btn-soft" onClick={() => setSelectedTaskIdsForBulk([])}>
              Clear
            </button>
            <button type="button" className="btn btn-soft" onClick={() => void handleBulkStatusChange("NOT_DONE")}>
              {STATUS_LABELS.NOT_DONE}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => void handleBulkStatusChange("ON_HOLD")}>
              {STATUS_LABELS.ON_HOLD}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => void handleBulkStatusChange("DONE")}>
              {STATUS_LABELS.DONE}
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void handleBulkDelete()}>
              Delete selected
            </button>
            <button type="button" className="btn btn-soft" onClick={() => handleExportCsv(false)}>
              Export CSV (all)
            </button>
            <button type="button" className="btn btn-soft" onClick={() => handleExportCsv(true)}>
              Export CSV (selected)
            </button>
          </div>
          {bulkMessage ? <p className="success-text">{bulkMessage}</p> : null}
        </section>

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
              selectable
              selectedForBulk={selectedTaskSet.has(task.id)}
              onToggleSelect={(checked) => handleToggleTaskSelection(task.id, checked)}
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
