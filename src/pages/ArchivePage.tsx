import { useEffect, useMemo, useState } from "react";
import { STATUS_LABELS } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput } from "../models";
import { formatDateTime, getDateKey } from "../utils/date";

interface ArchiveFilters {
  keyword: string;
  projectId: string;
  taskTypeId: string;
  fromDate: string;
  toDate: string;
  majorOnly: boolean;
}

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

function formatMonthLabel(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${value}-01T00:00:00`));
}

function groupByMonth(tasks: Task[]) {
  const map = new Map<string, Task[]>();

  for (const task of tasks) {
    const key = getDateKey(task.startAt).slice(0, 7);
    map.set(key, [...(map.get(key) ?? []), task]);
  }

  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, items]) => ({
      monthKey,
      title: formatMonthLabel(monthKey),
      tasks: items.sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()),
    }));
}

export function ArchivePage() {
  const { tasks, projects, taskTypes, setting, updateTask } = useAppData();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [showFilters, setShowFilters] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState<ArchiveFilters>({
    keyword: "",
    projectId: "",
    taskTypeId: "",
    fromDate: "",
    toDate: "",
    majorOnly: false,
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);

  const archivedTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status === "DONE" && new Date(task.startAt).getTime() < currentTime)
      .filter((task) => {
        if (filters.keyword.trim()) {
          const term = filters.keyword.trim().toLowerCase();
          const projectName = projectMap[task.projectId]?.name ?? "";
          const typeName = typeMap[task.taskTypeId]?.name ?? "";
          if (!`${task.title} ${task.content} ${projectName} ${typeName}`.toLowerCase().includes(term)) {
            return false;
          }
        }

        if (filters.projectId && task.projectId !== filters.projectId) {
          return false;
        }
        if (filters.taskTypeId && task.taskTypeId !== filters.taskTypeId) {
          return false;
        }
        if (filters.majorOnly && !task.isMajor) {
          return false;
        }

        const taskTime = new Date(task.startAt).getTime();
        if (filters.fromDate && taskTime < new Date(`${filters.fromDate}T00:00:00`).getTime()) {
          return false;
        }
        if (filters.toDate && taskTime > new Date(`${filters.toDate}T23:59:59`).getTime()) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const completedA = a.completedAt ? new Date(a.completedAt).getTime() : null;
        const completedB = b.completedAt ? new Date(b.completedAt).getTime() : null;

        if (completedA !== null && completedB !== null) {
          return completedB - completedA;
        }
        return new Date(b.startAt).getTime() - new Date(a.startAt).getTime();
      });
  }, [currentTime, filters, projectMap, tasks, typeMap]);

  const selectedTaskSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
  const selectedTasks = useMemo(() => archivedTasks.filter((task) => selectedTaskSet.has(task.id)), [archivedTasks, selectedTaskSet]);
  const groupedTasks = useMemo(() => groupByMonth(archivedTasks), [archivedTasks]);

  function resetFilters() {
    setFilters({
      keyword: "",
      projectId: "",
      taskTypeId: "",
      fromDate: "",
      toDate: "",
      majorOnly: false,
    });
    setSelectedTaskIds([]);
  }

  function toggleTaskSelection(taskId: string, checked: boolean) {
    setSelectedTaskIds((prev) => {
      if (checked) {
        return prev.includes(taskId) ? prev : [...prev, taskId];
      }
      return prev.filter((id) => id !== taskId);
    });
  }

  async function restoreTask(task: Task) {
    await updateTask(task.id, {
      ...toTaskInput(task),
      status: "NOT_DONE",
    });
    setSelectedTaskIds((prev) => prev.filter((id) => id !== task.id));
    setMessage(`"${task.title}" 일정을 복원했습니다.`);
  }

  async function restoreSelectedTasks() {
    if (selectedTasks.length === 0) {
      return;
    }

    for (const task of selectedTasks) {
      await updateTask(task.id, {
        ...toTaskInput(task),
        status: "NOT_DONE",
      });
    }

    setMessage(`선택한 일정 ${selectedTasks.length}개를 복원했습니다.`);
    setSelectedTaskIds([]);
  }

  return (
    <section className="archive-workspace">
      <header className="archive-hero">
        <div>
          <p className="eyebrow">ARCHIVE</p>
          <h2>보관함</h2>
          <p className="description-text">완료되었고 예정 시간이 지난 일정을 검색하고 복원할 수 있습니다.</p>
        </div>
        <div className="overview-stat-row">
          <span>보관 {archivedTasks.length}</span>
          <span>선택 {selectedTasks.length}</span>
        </div>
      </header>

      <section className="archive-search-bar" aria-label="보관함 검색">
        <label className="search-field">
          검색
          <input
            type="text"
            value={filters.keyword}
            onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="제목, 내용, 프로젝트, 종류 검색"
          />
        </label>
        <button type="button" className="btn btn-soft" onClick={() => setShowFilters((prev) => !prev)}>
          필터
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void restoreSelectedTasks()} disabled={selectedTasks.length === 0}>
          선택 복원
        </button>
      </section>

      {showFilters ? (
        <section className="archive-filter-panel" aria-label="상세 필터">
          <label>
            프로젝트
            <select value={filters.projectId} onChange={(event) => setFilters((prev) => ({ ...prev, projectId: event.target.value }))}>
              <option value="">전체</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            종류
            <select value={filters.taskTypeId} onChange={(event) => setFilters((prev) => ({ ...prev, taskTypeId: event.target.value }))}>
              <option value="">전체</option>
              {taskTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            시작일
            <input
              type="date"
              value={filters.fromDate}
              onChange={(event) => setFilters((prev) => ({ ...prev, fromDate: event.target.value }))}
            />
          </label>

          <label>
            종료일
            <input
              type="date"
              value={filters.toDate}
              onChange={(event) => setFilters((prev) => ({ ...prev, toDate: event.target.value }))}
            />
          </label>

          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={filters.majorOnly}
              onChange={(event) => setFilters((prev) => ({ ...prev, majorOnly: event.target.checked }))}
            />
            주요 일정만
          </label>

          <button type="button" className="btn btn-soft" onClick={resetFilters}>
            필터 초기화
          </button>
        </section>
      ) : null}

      {message ? <p className="success-text">{message}</p> : null}

      <section className="archive-list" aria-label="보관된 일정">
        {groupedTasks.length === 0 ? (
          <div className="empty-state">
            <h3>보관된 일정이 없습니다.</h3>
            <p>완료 상태이면서 예정 시간이 지난 일정이 이곳에 표시됩니다.</p>
          </div>
        ) : null}

        {groupedTasks.map((group) => (
          <section key={group.monthKey} className="archive-month-group">
            <header>
              <h3>{group.title}</h3>
              <span>{group.tasks.length}개</span>
            </header>

            <div className="archive-card-list">
              {group.tasks.map((task) => (
                <article key={task.id} className="archive-task-card">
                  <label className="archive-select">
                    <input
                      type="checkbox"
                      checked={selectedTaskSet.has(task.id)}
                      onChange={(event) => toggleTaskSelection(task.id, event.target.checked)}
                      aria-label={`${task.title} 선택`}
                    />
                  </label>
                  <div className="archive-task-main">
                    <strong>{task.title}</strong>
                    <span>
                      {formatDateTime(task.startAt, setting.timeFormat)} / {projectMap[task.projectId]?.name ?? "프로젝트 없음"} /{" "}
                      {typeMap[task.taskTypeId]?.name ?? "종류 없음"}
                    </span>
                    {task.content ? <p>{task.content}</p> : null}
                  </div>
                  <div className="archive-task-actions">
                    <span className="status-badge done">{STATUS_LABELS.DONE}</span>
                    <button type="button" className="btn btn-soft" onClick={() => void restoreTask(task)}>
                      복원
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </section>
    </section>
  );
}
