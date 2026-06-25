import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ColorSelector } from "../components/ColorSelector";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { DEFAULT_PROJECT_IDS, pickRandomPresetColor } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Project, Task, TaskFormInput, TaskStatus } from "../models";
import { addDays, compareByStartAtAsc, getDateKey } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";
import { isTaskActive, isTaskDone } from "../utils/taskStatus";

interface ProjectFormState {
  id?: string;
  name: string;
  color: string;
  description: string;
  isActive: boolean;
}

interface ProjectInput {
  id?: string;
  name: string;
  color: string;
  description?: string;
  isActive: boolean;
}

type ProjectTaskModalState =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      taskId: string;
    }
  | null;

type ProjectSettingsModalState =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      projectId: string;
    }
  | null;

type ProjectOverviewFilter = "all" | "active" | "done" | "week";

const PROJECT_FORM_AUTOSAVE_DELAY_MS = 700;

function createEmptyProjectForm(): ProjectFormState {
  return {
    id: undefined,
    name: "",
    color: pickRandomPresetColor(),
    description: "",
    isActive: true,
  };
}

function createProjectFormFromProject(project?: Project): ProjectFormState {
  if (!project) {
    return createEmptyProjectForm();
  }

  return {
    id: project.id,
    name: project.name,
    color: project.color,
    description: project.description ?? "",
    isActive: project.isActive,
  };
}

function buildProjectInput(form: ProjectFormState): { input?: ProjectInput; error?: string } {
  const name = form.name.trim();
  if (!name) {
    return { error: "프로젝트명을 입력해 주세요." };
  }

  return {
    input: {
      id: form.id,
      name,
      color: form.color,
      description: form.description.trim(),
      isActive: form.isActive,
    },
  };
}

function serializeProjectInput(input: ProjectInput): string {
  return JSON.stringify({
    id: input.id ?? "",
    name: input.name.trim(),
    color: input.color,
    description: input.description?.trim() ?? "",
    isActive: input.isActive,
  });
}

function toTaskInput(task: Task, statusOverride?: TaskStatus, projectIdOverride?: string): TaskFormInput {
  return {
    title: task.title,
    content: task.content,
    taskTypeId: task.taskTypeId,
    projectId: projectIdOverride ?? task.projectId,
    status: statusOverride ?? task.status,
    startAt: task.startAt,
    endAt: task.endAt,
    isMajor: task.isMajor,
  };
}

interface ProjectEditorPanelProps {
  initialProject?: Project;
  createMode: boolean;
  onSaveProject: (input: ProjectInput) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onClose: () => void;
}

function ProjectEditorPanel({ initialProject, createMode, onSaveProject, onDeleteProject, onClose }: ProjectEditorPanelProps) {
  const [form, setForm] = useState<ProjectFormState>(() => {
    return createMode ? createEmptyProjectForm() : createProjectFormFromProject(initialProject);
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const autoSaveSnapshotRef = useRef(
    (() => {
      const built = buildProjectInput(form);
      return built.input ? serializeProjectInput(built.input) : "";
    })(),
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setForm(createMode ? createEmptyProjectForm() : createProjectFormFromProject(initialProject));
      setError("");
      setSuccess("");
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [createMode, initialProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (createMode || !form.id) {
      autoSaveSnapshotRef.current = "";
      return;
    }

    const built = buildProjectInput(form);
    if (!built.input) {
      return;
    }

    const snapshot = serializeProjectInput(built.input);
    if (snapshot === autoSaveSnapshotRef.current) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void onSaveProject(built.input as ProjectInput)
        .then(() => {
          autoSaveSnapshotRef.current = snapshot;
          setError("");
          setSuccess("자동 저장됨.");
        })
        .catch((saveError) => {
          setError(saveError instanceof Error ? saveError.message : "프로젝트 저장에 실패했습니다.");
        });
    }, PROJECT_FORM_AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [createMode, form, onSaveProject]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const built = buildProjectInput(form);
    if (!built.input) {
      setError(built.error ?? "프로젝트 입력값이 올바르지 않습니다.");
      return;
    }

    try {
      await onSaveProject(built.input);
      autoSaveSnapshotRef.current = serializeProjectInput(built.input);
      setSuccess(form.id ? "저장됨." : "프로젝트가 생성되었습니다.");
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "프로젝트 저장에 실패했습니다.");
    }
  }

  async function handleDelete() {
    if (!form.id) {
      return;
    }

    setError("");
    setSuccess("");
    try {
      await onDeleteProject(form.id);
      setSuccess("프로젝트가 삭제되었습니다.");
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "프로젝트 삭제에 실패했습니다.");
    }
  }

  return (
    <section className="modal-card panel project-settings-card" role="dialog" aria-modal="true" aria-label="프로젝트 설정">
      <header className="panel-header">
        <h2>{createMode ? "새 프로젝트" : "프로젝트 설정"}</h2>
        <button className="btn btn-soft" type="button" onClick={onClose}>
          닫기
        </button>
      </header>

      <form className="task-form" onSubmit={handleSubmit}>
        <label>
          프로젝트명
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            required
          />
        </label>

        <label>
          색상
          <ColorSelector value={form.color} onChange={(nextColor) => setForm((prev) => ({ ...prev, color: nextColor }))} />
        </label>

        <label>
          프로젝트 설명
          <textarea
            rows={6}
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="프로젝트 관련 메모와 요약을 작성하세요."
          />
        </label>

        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
          />
          사용
        </label>

        <div className="button-row">
          <button className="btn btn-primary" type="submit">
            {form.id ? "저장" : "생성"}
          </button>

          {form.id ? (
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => {
                void handleDelete();
              }}
              disabled={DEFAULT_PROJECT_IDS.includes(form.id)}
            >
              삭제
            </button>
          ) : null}
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {success ? <p className="success-text">{success}</p> : null}
      </form>
    </section>
  );
}

export function ProjectsPage() {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask, upsertProject, deleteProject } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectKeyword, setProjectKeyword] = useState("");
  const [taskKeyword, setTaskKeyword] = useState("");
  const [taskTypeFilterId, setTaskTypeFilterId] = useState("all");
  const [overviewFilter, setOverviewFilter] = useState<ProjectOverviewFilter>("active");
  const [taskModalState, setTaskModalState] = useState<ProjectTaskModalState>(null);
  const [projectSettingsModal, setProjectSettingsModal] = useState<ProjectSettingsModalState>(null);
  const [taskFormSerial, setTaskFormSerial] = useState(0);

  const selectedProjectIdFromQuery = searchParams.get("projectId");

  const sortedProjects = useMemo(() => {
    const keyword = projectKeyword.trim().toLowerCase();
    return [...projects]
      .filter((project) => {
        if (!keyword) {
          return true;
        }
        return `${project.name} ${project.description ?? ""}`.toLowerCase().includes(keyword);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [projectKeyword, projects]);

  const allSortedProjects = useMemo(() => [...projects].sort((a, b) => a.name.localeCompare(b.name, "ko")), [projects]);

  const selectedProject = useMemo(() => {
    if (selectedProjectIdFromQuery) {
      const byQuery = projects.find((project) => project.id === selectedProjectIdFromQuery);
      if (byQuery) {
        return byQuery;
      }
    }
    return allSortedProjects[0];
  }, [allSortedProjects, projects, selectedProjectIdFromQuery]);

  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const sortedTaskTypes = useMemo(() => [...taskTypes].sort((a, b) => a.name.localeCompare(b.name, "ko")), [taskTypes]);
  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const conflictMap = useMemo(() => buildTaskConflictMap(tasks), [tasks]);

  const projectStats = useMemo(() => {
    const todayKey = getDateKey(new Date());
    const weekEndKey = getDateKey(addDays(new Date(), 7));
    const map: Record<string, { total: number; active: number; done: number; canceled: number; week: number; conflicts: number; recent: Task[]; completion: number }> = {};

    for (const project of projects) {
      map[project.id] = { total: 0, active: 0, done: 0, canceled: 0, week: 0, conflicts: 0, recent: [], completion: 0 };
    }

    for (const task of tasks) {
      const stats = map[task.projectId] ?? { total: 0, active: 0, done: 0, canceled: 0, week: 0, conflicts: 0, recent: [], completion: 0 };
      stats.total += 1;
      if (isTaskDone(task.status)) {
        stats.done += 1;
      } else if (task.status === "CANCELED") {
        stats.canceled += 1;
      }
      if (isTaskActive(task.status)) {
        stats.active += 1;
      }
      const taskKey = getDateKey(task.startAt);
      if (taskKey >= todayKey && taskKey <= weekEndKey) {
        stats.week += 1;
      }
      if ((conflictMap[task.id]?.length ?? 0) > 0) {
        stats.conflicts += 1;
      }
      stats.recent.push(task);
      map[task.projectId] = stats;
    }

    for (const stats of Object.values(map)) {
      const completionBase = Math.max(0, stats.total - stats.canceled);
      stats.completion = completionBase > 0 ? Math.round((stats.done / completionBase) * 100) : 0;
      stats.recent = stats.recent.sort(compareByStartAtAsc).slice(0, 2);
    }

    return map;
  }, [conflictMap, projects, tasks]);

  const projectTasks = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    const keyword = taskKeyword.trim().toLowerCase();
    const todayKey = getDateKey(new Date());
    const weekEndKey = getDateKey(addDays(new Date(), 7));
    return tasks
      .filter((task) => task.projectId === selectedProject.id)
      .filter((task) => {
        if (overviewFilter === "all") {
          return true;
        }

        if (overviewFilter === "active") {
          return isTaskActive(task.status);
        }

        if (overviewFilter === "done") {
          return isTaskDone(task.status);
        }

        const taskKey = getDateKey(task.startAt);
        return taskKey >= todayKey && taskKey <= weekEndKey;
      })
      .filter((task) => taskTypeFilterId === "all" || task.taskTypeId === taskTypeFilterId)
      .filter((task) => {
        if (!keyword) {
          return true;
        }
        const typeName = typeMap[task.taskTypeId]?.name ?? "";
        return `${task.title} ${task.content} ${typeName}`.toLowerCase().includes(keyword);
      })
      .sort(compareByStartAtAsc);
  }, [overviewFilter, selectedProject, taskKeyword, taskTypeFilterId, tasks, typeMap]);

  const editingTask = useMemo(() => {
    if (taskModalState?.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);

  const activeTaskModalState: ProjectTaskModalState =
    taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;

  const editingProject = useMemo(() => {
    if (projectSettingsModal?.mode !== "edit") {
      return undefined;
    }
    return projects.find((project) => project.id === projectSettingsModal.projectId);
  }, [projectSettingsModal, projects]);

  useEffect(() => {
    if (!activeTaskModalState && !projectSettingsModal) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTaskModalState(null);
        setProjectSettingsModal(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTaskModalState, projectSettingsModal]);

  async function handleCreateProjectTask(input: TaskFormInput) {
    if (!selectedProject) {
      return;
    }

    await createTask({
      ...input,
      projectId: selectedProject.id,
    });
    setTaskModalState(null);
    setTaskFormSerial((prev) => prev + 1);
  }

  async function handleUpdateProjectTask(input: TaskFormInput) {
    if (!editingTask) {
      return;
    }

    await updateTask(editingTask.id, input);
  }

  async function handleDeleteProjectTask() {
    if (!editingTask) {
      return;
    }

    await removeTask(editingTask.id);
    setTaskModalState(null);
  }

  async function handleSaveProject(input: ProjectInput) {
    await upsertProject(input);
  }

  async function handleDeleteProject(projectId: string) {
    await deleteProject(projectId);
    if (selectedProjectIdFromQuery === projectId) {
      setSearchParams({});
    }
  }

  function selectProject(projectId: string) {
    setSearchParams({ projectId });
    setTaskKeyword("");
    setTaskTypeFilterId("all");
    setOverviewFilter("active");
  }

  return (
    <div className="projects-workspace">
      <section className="projects-overview">
        <div>
          <p className="eyebrow">PROJECTS</p>
          <h2>프로젝트</h2>
          <p className="description-text">프로젝트별 진행 상황을 먼저 보고, 필요한 프로젝트 안에서 일정을 관리합니다.</p>
        </div>
        <div className="projects-actions">
          <label className="search-field">
            검색
            <input
              type="text"
              value={projectKeyword}
              onChange={(event) => setProjectKeyword(event.target.value)}
              placeholder="프로젝트 검색"
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={() => setProjectSettingsModal({ mode: "create" })}>
            새 프로젝트
          </button>
        </div>
      </section>

      <section className="project-card-grid" aria-label="프로젝트 목록">
        {sortedProjects.length === 0 ? (
          <div className="empty-state">
            <h3>프로젝트가 없습니다.</h3>
            <p>검색어를 줄이거나 새 프로젝트를 추가하세요.</p>
          </div>
        ) : null}

        {sortedProjects.map((project) => {
          const stats = projectStats[project.id] ?? { total: 0, active: 0, done: 0, canceled: 0, week: 0, conflicts: 0, recent: [], completion: 0 };
          return (
            <button
              key={project.id}
              type="button"
              className={`project-summary-card ${selectedProject?.id === project.id ? "selected" : ""}`}
              onClick={() => selectProject(project.id)}
            >
              <span className="project-color-bar" style={{ backgroundColor: project.color }} />
              <span className="project-card-title">
                <strong>{project.name}</strong>
                <small>{project.isActive ? "사용 중" : "비활성"}</small>
              </span>
              <span className="project-card-metrics">
                <span>진행 {stats.active}</span>
                <span>이번 주 {stats.week}</span>
                <span>완료율 {stats.completion}%</span>
                {stats.conflicts > 0 ? <span>충돌 {stats.conflicts}</span> : null}
              </span>
              <span className="project-card-recent">
                {stats.recent.length === 0 ? <small>아직 일정이 없습니다.</small> : null}
                {stats.recent.map((task) => (
                  <small key={task.id}>{task.title}</small>
                ))}
              </span>
            </button>
          );
        })}
      </section>

      <section className="project-detail-panel">
        {selectedProject ? (
          <>
            <header className="panel-header">
              <div>
                <p className="eyebrow">PROJECT DETAIL</p>
                <h2>{selectedProject.name}</h2>
                {selectedProject.description ? <p className="description-text">{selectedProject.description}</p> : null}
              </div>
              <div className="panel-header-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setTaskFormSerial((prev) => prev + 1);
                    setTaskModalState({ mode: "create" });
                  }}
                >
                  일정 추가
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => setProjectSettingsModal({ mode: "edit", projectId: selectedProject.id })}
                >
                  프로젝트 설정
                </button>
              </div>
            </header>

            <div className="overview-stat-row overview-filter-row">
              <button
                type="button"
                className={`overview-stat-button all ${overviewFilter === "all" ? "active" : ""}`}
                onClick={() => setOverviewFilter("all")}
                aria-pressed={overviewFilter === "all"}
              >
                전체 {projectStats[selectedProject.id]?.total ?? 0}
              </button>
              <button
                type="button"
                className={`overview-stat-button active-filter ${overviewFilter === "active" ? "active" : ""}`}
                onClick={() => setOverviewFilter("active")}
                aria-pressed={overviewFilter === "active"}
              >
                진행 {projectStats[selectedProject.id]?.active ?? 0}
              </button>
              <button
                type="button"
                className={`overview-stat-button done-filter ${overviewFilter === "done" ? "active" : ""}`}
                onClick={() => setOverviewFilter("done")}
                aria-pressed={overviewFilter === "done"}
              >
                완료 {projectStats[selectedProject.id]?.done ?? 0}
              </button>
              <button
                type="button"
                className={`overview-stat-button week-filter ${overviewFilter === "week" ? "active" : ""}`}
                onClick={() => setOverviewFilter("week")}
                aria-pressed={overviewFilter === "week"}
              >
                이번주 {projectStats[selectedProject.id]?.week ?? 0}
              </button>
            </div>

            <div className="overview-stat-row">
              <span>진행 {projectStats[selectedProject.id]?.active ?? 0}</span>
              <span>완료 {projectStats[selectedProject.id]?.done ?? 0}</span>
              <span>취소 {projectStats[selectedProject.id]?.canceled ?? 0}</span>
              <span>이번 주 {projectStats[selectedProject.id]?.week ?? 0}</span>
              <span>충돌 {projectStats[selectedProject.id]?.conflicts ?? 0}</span>
            </div>

            <div className="project-task-filter-bar">
              <label className="search-field">
                프로젝트 일정 검색
                <input
                  type="text"
                  value={taskKeyword}
                  onChange={(event) => setTaskKeyword(event.target.value)}
                  placeholder="제목 또는 내용 검색"
                />
              </label>

              <label>
                종류
                <select value={taskTypeFilterId} onChange={(event) => setTaskTypeFilterId(event.target.value)}>
                  <option value="all">전체 종류</option>
                  {sortedTaskTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="task-stack">
              {projectTasks.length === 0 ? <p className="empty-text">조건에 맞는 프로젝트 일정이 없습니다.</p> : null}
              {projectTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  project={projectMap[task.projectId]}
                  taskType={typeMap[task.taskTypeId]}
                  timeFormat={setting.timeFormat}
                  hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
                  onClick={() => setTaskModalState({ mode: "edit", taskId: task.id })}
                  onStatusChange={(status) => {
                    void updateTask(task.id, toTaskInput(task, status, selectedProject.id));
                  }}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h3>프로젝트를 선택하세요.</h3>
            <p>프로젝트 카드에서 항목을 선택하면 일정과 요약이 표시됩니다.</p>
          </div>
        )}
      </section>

      {projectSettingsModal ? (
        <div className="modal-backdrop" onClick={() => setProjectSettingsModal(null)}>
          <div onClick={(event) => event.stopPropagation()}>
            <ProjectEditorPanel
              key={projectSettingsModal.mode === "create" ? "new-project" : editingProject?.id ?? "project"}
              initialProject={projectSettingsModal.mode === "edit" ? editingProject : undefined}
              createMode={projectSettingsModal.mode === "create"}
              onSaveProject={handleSaveProject}
              onDeleteProject={handleDeleteProject}
              onClose={() => setProjectSettingsModal(null)}
            />
          </div>
        </div>
      ) : null}

      {activeTaskModalState ? (
        <div className="modal-backdrop" onClick={() => setTaskModalState(null)}>
          <section
            className="modal-card panel"
            role="dialog"
            aria-modal="true"
            aria-label="프로젝트 일정 대화상자"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>{activeTaskModalState.mode === "create" ? "프로젝트 일정 추가" : "프로젝트 일정 수정"}</h2>
              <button type="button" className="btn btn-soft" onClick={() => setTaskModalState(null)}>
                닫기
              </button>
            </header>

            {activeTaskModalState.mode === "create" && selectedProject ? (
              <TaskForm
                key={`project-task-new-${selectedProject.id}-${taskFormSerial}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                fixedProjectId={selectedProject.id}
                timeFormat={setting.timeFormat}
                onSubmit={handleCreateProjectTask}
              />
            ) : null}

            {activeTaskModalState.mode === "edit" && editingTask && selectedProject ? (
              <TaskForm
                key={`project-task-edit-${editingTask.id}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                initialTask={editingTask}
                timeFormat={setting.timeFormat}
                onSubmit={handleUpdateProjectTask}
                onDelete={handleDeleteProjectTask}
                onCancel={() => setTaskModalState(null)}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
