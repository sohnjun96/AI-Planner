import { useEffect, useMemo, useState } from "react";
import { TaskItem } from "../components/TaskItem";
import { useAppData } from "../context/AppDataContext";
import type { TaskFormInput } from "../models";

interface ArchiveFilters {
  keyword: string;
  projectId: string;
  taskTypeId: string;
  fromDate: string;
  toDate: string;
  majorOnly: boolean;
}

function toTaskInput(task: {
  title: string;
  content: string;
  taskTypeId: string;
  projectId: string;
  status: "NOT_DONE" | "ON_HOLD" | "DONE";
  startAt: string;
  endAt?: string;
  isMajor: boolean;
}): TaskFormInput {
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

export function ArchivePage() {
  const { tasks, projects, taskTypes, setting, updateTask } = useAppData();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
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
          if (!`${task.title} ${task.content}`.toLowerCase().includes(term)) {
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
  }, [tasks, filters, currentTime]);

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>지난 업무</h2>
        <small>{archivedTasks.length}개</small>
      </header>

      <div className="archive-filter-grid">
        <label>
          검색
          <input
            type="text"
            value={filters.keyword}
            onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))}
            placeholder="제목 또는 내용으로 검색"
          />
        </label>

        <label>
          프로젝트
          <select
            value={filters.projectId}
            onChange={(event) => setFilters((prev) => ({ ...prev, projectId: event.target.value }))}
          >
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
          <select
            value={filters.taskTypeId}
            onChange={(event) => setFilters((prev) => ({ ...prev, taskTypeId: event.target.value }))}
          >
            <option value="">전체</option>
            {taskTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={filters.majorOnly}
            onChange={(event) => setFilters((prev) => ({ ...prev, majorOnly: event.target.checked }))}
          />
          주요 일정만
        </label>
      </div>

      <div className="form-grid two-col">
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
      </div>

      <div className="button-row">
        <button
          type="button"
          className="btn btn-soft"
          onClick={() =>
            setFilters({
              keyword: "",
              projectId: "",
              taskTypeId: "",
              fromDate: "",
              toDate: "",
              majorOnly: false,
            })
          }
        >
          필터 초기화
        </button>
      </div>

      <p className="description-text">
        이 페이지는 완료 상태이면서 예정 시간이 지난 일정을 보여줍니다. 상태를 변경하면 다시 복원할 수 있습니다.
      </p>

      <div className="task-stack">
        {archivedTasks.length === 0 ? <p className="empty-text">지난 업무가 없습니다.</p> : null}
        {archivedTasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            project={projectMap[task.projectId]}
            taskType={typeMap[task.taskTypeId]}
            timeFormat={setting.timeFormat}
            onStatusChange={(status) => {
              void updateTask(task.id, {
                ...toTaskInput(task),
                status,
              });
            }}
          />
        ))}
      </div>
    </section>
  );
}
