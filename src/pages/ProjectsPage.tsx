import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ColorSelector } from "../components/ColorSelector";
import { TaskForm } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { DEFAULT_PROJECT_ID, pickRandomPresetColor } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Project, Task, TaskFormInput, TaskStatus } from "../models";
import { compareByStartAtAsc } from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";

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

const PROJECT_FORM_AUTOSAVE_DELAY_MS = 700;

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

type ProjectTaskModalState =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      taskId: string;
    }
  | null;

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
  onExitCreateMode: () => void;
}

function ProjectEditorPanel({
  initialProject,
  createMode,
  onSaveProject,
  onDeleteProject,
  onExitCreateMode,
}: ProjectEditorPanelProps) {
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

      if (!form.id) {
        setForm(createEmptyProjectForm());
        autoSaveSnapshotRef.current = "";
      }
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
      setForm(createEmptyProjectForm());
      autoSaveSnapshotRef.current = "";
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "프로젝트 삭제에 실패했습니다.");
    }
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{createMode ? "새 프로젝트" : "프로젝트 수정"}</h2>
        {createMode ? (
          <button className="btn btn-soft" type="button" onClick={onExitCreateMode}>
            선택한 프로젝트로 돌아가기
          </button>
        ) : null}
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
              disabled={form.id === DEFAULT_PROJECT_ID}
            >
              삭제
            </button>
          ) : null}

          <button
            className="btn btn-soft"
            type="button"
            onClick={() => {
              setError("");
              setSuccess("");
              const nextForm = createMode ? createEmptyProjectForm() : createProjectFormFromProject(initialProject);
              setForm(nextForm);
              const built = buildProjectInput(nextForm);
              autoSaveSnapshotRef.current = built.input ? serializeProjectInput(built.input) : "";
            }}
          >
            초기화
          </button>
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
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [taskKeyword, setTaskKeyword] = useState("");
  const [taskModalState, setTaskModalState] = useState<ProjectTaskModalState>(null);
  const [taskFormSerial, setTaskFormSerial] = useState(0);

  const selectedProjectIdFromQuery = searchParams.get("projectId");

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [projects],
  );

  const selectedProject = useMemo(() => {
    if (selectedProjectIdFromQuery) {
      const byQuery = sortedProjects.find((project) => project.id === selectedProjectIdFromQuery);
      if (byQuery) {
        return byQuery;
      }
    }
    return sortedProjects[0];
  }, [selectedProjectIdFromQuery, sortedProjects]);

  const taskCountByProject = useMemo(() => {
    const map: Record<string, number> = {};
    for (const task of tasks) {
      map[task.projectId] = (map[task.projectId] ?? 0) + 1;
    }
    return map;
  }, [tasks]);

  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const conflictMap = useMemo(() => buildTaskConflictMap(tasks), [tasks]);

  const projectTasks = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    return tasks
      .filter((task) => task.projectId === selectedProject.id)
      .filter((task) => {
        if (!taskKeyword.trim()) {
          return true;
        }
        const keyword = taskKeyword.trim().toLowerCase();
        const typeName = typeMap[task.taskTypeId]?.name ?? "";
        const projectName = projectMap[task.projectId]?.name ?? "";
        return `${task.title} ${task.content} ${typeName} ${projectName}`.toLowerCase().includes(keyword);
      })
      .sort(compareByStartAtAsc);
  }, [selectedProject, tasks, taskKeyword, typeMap, projectMap]);

  const editingTask = useMemo(() => {
    if (taskModalState?.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);

  const activeTaskModalState: ProjectTaskModalState =
    taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;

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
    if (!editingTask || !selectedProject) {
      return;
    }

    await updateTask(editingTask.id, {
      ...input,
      projectId: selectedProject.id,
    });
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

    setIsCreatingProject(false);
  }

  return (
    <div className="project-management-layout">
      <section className="panel">
        <header className="panel-header">
          <h2>프로젝트</h2>
          <small>{sortedProjects.length}개</small>
        </header>

        <div className="button-row">
          <button
            className="btn btn-soft"
            type="button"
            onClick={() => {
              setIsCreatingProject(true);
            }}
          >
            프로젝트 추가
          </button>
        </div>

        <ul className="entity-list">
          {sortedProjects.map((project) => (
            <li
              key={project.id}
              className={`entity-item ${selectedProject?.id === project.id ? "selected" : ""}`}
              onClick={() => {
                setSearchParams({ projectId: project.id });
                setIsCreatingProject(false);
              }}
              role="button"
              tabIndex={0}
              aria-label={`${project.name} 프로젝트 선택`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSearchParams({ projectId: project.id });
                  setIsCreatingProject(false);
                }
              }}
            >
              <span className="color-dot" style={{ backgroundColor: project.color }} />
              <strong>{project.name}</strong>
              <small>{taskCountByProject[project.id] ?? 0}건</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel project-task-panel">
        <header className="panel-header">
          <h2>{selectedProject ? `${selectedProject.name} 일정` : "프로젝트 일정"}</h2>
          <div className="panel-header-actions">
            <small>{projectTasks.length}개</small>
            <button
              type="button"
              className="btn btn-soft"
              disabled={!selectedProject}
              onClick={() => {
                setTaskFormSerial((prev) => prev + 1);
                setTaskModalState({ mode: "create" });
              }}
              >
              일정 추가
            </button>
          </div>
        </header>

        {selectedProject?.description ? <p className="description-text">{selectedProject.description}</p> : null}

        <label>
          프로젝트 일정 검색
          <input
            type="text"
            value={taskKeyword}
            onChange={(event) => setTaskKeyword(event.target.value)}
            placeholder="제목 또는 내용 검색"
          />
        </label>

        <div className="task-stack">
          {!selectedProject ? <p className="empty-text">프로젝트가 없습니다.</p> : null}
          {selectedProject && projectTasks.length === 0 ? (
            <p className="empty-text">이 프로젝트에는 아직 일정이 없습니다.</p>
          ) : null}
          {projectTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              project={projectMap[task.projectId]}
              taskType={typeMap[task.taskTypeId]}
              timeFormat={setting.timeFormat}
              hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
              onClick={() => {
                setTaskModalState({ mode: "edit", taskId: task.id });
              }}
              onStatusChange={(status) => {
                void updateTask(task.id, toTaskInput(task, status, selectedProject?.id));
              }}
            />
          ))}
        </div>
      </section>

      <ProjectEditorPanel
        key={`project-editor-${isCreatingProject ? "new" : selectedProject?.id ?? "none"}`}
        initialProject={!isCreatingProject ? selectedProject : undefined}
        createMode={isCreatingProject}
        onSaveProject={handleSaveProject}
        onDeleteProject={handleDeleteProject}
        onExitCreateMode={() => {
          setIsCreatingProject(false);
        }}
      />

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
            aria-label="프로젝트 일정 대화상자"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>{activeTaskModalState.mode === "create" ? "프로젝트 일정 추가" : "프로젝트 일정 수정"}</h2>
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
                fixedProjectId={selectedProject.id}
                initialTask={editingTask}
                timeFormat={setting.timeFormat}
                onSubmit={handleUpdateProjectTask}
                onDelete={handleDeleteProjectTask}
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

