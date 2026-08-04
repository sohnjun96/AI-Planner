import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "../routing";
import { ColorSelector } from "../components/ColorSelector";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { TaskForm, type TaskFormInteractionState } from "../components/TaskForm";
import { TaskItem } from "../components/TaskItem";
import { TaskModal } from "../components/TaskModal";
import { DEFAULT_PROJECT_IDS, STATUS_LABELS, pickRandomPresetColor } from "../constants";
import { useAppData } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { Project, ProjectSubcategory, Task, TaskFormInput, TaskStatus } from "../models";
import { addDays, compareByStartAtAsc, formatDateTime, getDateKey } from "../utils/date";
import { compareProjects } from "../utils/projectOrder";
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

interface ProjectContextMenuState {
  x: number;
  y: number;
  taskId: string;
}

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

interface SubcategoryManagerProps {
  subcategories: ProjectSubcategory[];
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function SubcategoryManager({ subcategories, onCreate, onRename, onDelete }: SubcategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const sorted = [...subcategories].sort((a, b) => a.order - b.order);

  async function handleAdd() {
    const value = newName.trim();
    if (!value) {
      return;
    }
    await onCreate(value);
    setNewName("");
  }

  async function commitRename(id: string) {
    const value = editingName.trim();
    if (value) {
      await onRename(id, value);
    }
    setEditingId(null);
    setEditingName("");
  }

  return (
    <div className="subcategory-manager">
      <span className="subcategory-manager-label">세부 항목</span>
      <div className="subcategory-list">
        {sorted.length === 0 ? (
          <p className="empty-text">아직 세부 항목이 없습니다. 아래에서 추가하세요.</p>
        ) : (
          sorted.map((sub) => (
            <div key={sub.id} className="subcategory-row">
              {editingId === sub.id ? (
                <input
                  className="subcategory-edit-input"
                  value={editingName}
                  autoFocus
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitRename(sub.id);
                    }
                    if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  onBlur={() => void commitRename(sub.id)}
                />
              ) : (
                <button
                  type="button"
                  className="subcategory-name"
                  onClick={() => {
                    setEditingId(sub.id);
                    setEditingName(sub.name);
                  }}
                >
                  {sub.name}
                </button>
              )}
              <button
                type="button"
                className="subcategory-delete"
                aria-label={`${sub.name} 삭제`}
                onClick={() => {
                  if (window.confirm(`"${sub.name}" 세부 항목을 삭제할까요? 이 항목의 노트는 미분류로 이동합니다.`)) {
                    void onDelete(sub.id);
                  }
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <div className="subcategory-add-row">
        <input
          type="text"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="새 세부 항목 이름"
        />
        <button type="button" className="btn btn-soft btn-compact" onClick={() => void handleAdd()}>
          추가
        </button>
      </div>
    </div>
  );
}

interface ProjectEditorPanelProps {
  initialProject?: Project;
  createMode: boolean;
  subcategories: ProjectSubcategory[];
  onSaveProject: (input: ProjectInput) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onCreateSubcategory: (projectId: string, name: string) => Promise<void>;
  onRenameSubcategory: (id: string, name: string) => Promise<void>;
  onDeleteSubcategory: (id: string) => Promise<void>;
  onClose: () => void;
  onCommitClose: () => void;
  onStateChange: (state: TaskFormInteractionState) => void;
}

function ProjectEditorPanel({
  initialProject,
  createMode,
  subcategories,
  onSaveProject,
  onDeleteProject,
  onCreateSubcategory,
  onRenameSubcategory,
  onDeleteSubcategory,
  onClose,
  onCommitClose,
  onStateChange,
}: ProjectEditorPanelProps) {
  const [form, setForm] = useState<ProjectFormState>(() => {
    return createMode ? createEmptyProjectForm() : createProjectFormFromProject(initialProject);
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const initialFormSnapshotRef = useRef(JSON.stringify(form));
  const isDirty = JSON.stringify(form) !== initialFormSnapshotRef.current;

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const nextForm = createMode ? createEmptyProjectForm() : createProjectFormFromProject(initialProject);
      initialFormSnapshotRef.current = JSON.stringify(nextForm);
      setForm(nextForm);
      setError("");
      setSuccess("");
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [createMode, initialProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onStateChange({ isDirty, isBusy: isSubmitting });
  }, [isDirty, isSubmitting, onStateChange]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const built = buildProjectInput(form);
    if (!built.input) {
      setError(built.error ?? "프로젝트 입력값이 올바르지 않습니다.");
      formRef.current?.querySelector<HTMLInputElement>('input[name="projectName"]')?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      await onSaveProject(built.input);
      setSuccess(form.id ? "저장됨." : "프로젝트가 생성되었습니다.");
      onCommitClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "프로젝트 저장에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!form.id) {
      return;
    }

    setError("");
    setSuccess("");
    setIsSubmitting(true);
    try {
      await onDeleteProject(form.id);
      setSuccess("프로젝트가 삭제되었습니다.");
      onCommitClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "프로젝트 삭제에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="modal-card panel project-settings-card" role="dialog" aria-modal="true" aria-label="프로젝트 설정">
      <header className="panel-header">
        <h2>{createMode ? "새 프로젝트" : "프로젝트 설정"}</h2>
        <button className="btn btn-soft" type="button" onClick={onClose} disabled={isSubmitting}>
          {isSubmitting ? "저장 중…" : "닫기"}
        </button>
      </header>

      <form
        ref={formRef}
        className="task-form"
        onSubmit={handleSubmit}
        aria-busy={isSubmitting}
        data-project-form-dirty={isDirty ? "true" : "false"}
        noValidate
      >
        <label>
          프로젝트명
          <input
            type="text"
            name="projectName"
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

        {!createMode && form.id ? (
          <SubcategoryManager
            subcategories={subcategories}
            onCreate={(name) => onCreateSubcategory(form.id as string, name)}
            onRename={onRenameSubcategory}
            onDelete={onDeleteSubcategory}
          />
        ) : (
          <p className="description-text">프로젝트를 먼저 저장하면 세부 항목을 추가할 수 있습니다.</p>
        )}

        <div className="button-row">
          <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "저장 중…" : form.id ? "변경사항 저장" : "프로젝트 생성"}
          </button>

          {form.id ? (
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => {
                void handleDelete();
              }}
              disabled={isSubmitting || DEFAULT_PROJECT_IDS.includes(form.id)}
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
  const {
    tasks,
    projects,
    taskTypes,
    setting,
    projectSubcategories,
    createTask,
    updateTask,
    removeTask,
    upsertProject,
    deleteProject,
    reorderProjects,
    createSubcategory,
    renameSubcategory,
    deleteSubcategory,
  } = useAppData();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projectKeyword, setProjectKeyword] = useState("");
  const [taskKeyword, setTaskKeyword] = useState("");
  const [selectedTaskTypeIds, setSelectedTaskTypeIds] = useState<string[]>([]);
  const [overviewFilter, setOverviewFilter] = useState<ProjectOverviewFilter>("active");
  const [taskModalState, setTaskModalState] = useState<ProjectTaskModalState>(null);
  const [taskFormInteraction, setTaskFormInteraction] = useState<TaskFormInteractionState>({
    isDirty: false,
    isBusy: false,
  });
  const [projectSettingsModal, setProjectSettingsModal] = useState<ProjectSettingsModalState>(null);
  const [projectFormInteraction, setProjectFormInteraction] = useState<TaskFormInteractionState>({
    isDirty: false,
    isBusy: false,
  });
  const [contextMenu, setContextMenu] = useState<ProjectContextMenuState | null>(null);
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
      .sort(compareProjects);
  }, [projectKeyword, projects]);

  const allSortedProjects = useMemo(() => [...projects].sort(compareProjects), [projects]);

  // 드래그앤드롭 순서 변경 — 검색 중에는 부분 목록이라 순서가 모호해 비활성화한다
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const isDragEnabled = !projectKeyword.trim();

  function handleProjectDrop(targetId: string) {
    const draggedId = dragProjectId;
    setDragProjectId(null);
    setDragOverProjectId(null);
    if (!draggedId || draggedId === targetId) {
      return;
    }
    // 끌어온 카드가 대상 카드의 자리를 차지하도록 이동 (array-move)
    const ids = sortedProjects.map((project) => project.id);
    const fromIndex = ids.indexOf(draggedId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, draggedId);
    void reorderProjects(ids);
  }

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
      .filter((task) => selectedTaskTypeIds.length === 0 || selectedTaskTypeIds.includes(task.taskTypeId))
      .filter((task) => {
        if (!keyword) {
          return true;
        }
        const typeName = typeMap[task.taskTypeId]?.name ?? "";
        return `${task.title} ${task.content} ${typeName}`.toLowerCase().includes(keyword);
      })
      .sort(compareByStartAtAsc);
  }, [overviewFilter, selectedProject, selectedTaskTypeIds, taskKeyword, tasks, typeMap]);

  const editingTask = useMemo(() => {
    if (taskModalState?.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);

  const contextTask = useMemo(() => {
    if (!contextMenu) {
      return undefined;
    }
    return tasks.find((task) => task.id === contextMenu.taskId);
  }, [contextMenu, tasks]);

  const activeTaskModalState: ProjectTaskModalState =
    taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;

  const editingProject = useMemo(() => {
    if (projectSettingsModal?.mode !== "edit") {
      return undefined;
    }
    return projects.find((project) => project.id === projectSettingsModal.projectId);
  }, [projectSettingsModal, projects]);
  const projectSettingsDialogRef = useDialogFocus<HTMLDivElement>({
    isOpen: Boolean(projectSettingsModal),
    onClose: closeProjectSettings,
  });

  function finishProjectSettings() {
    setProjectSettingsModal(null);
    setProjectFormInteraction({ isDirty: false, isBusy: false });
  }

  function closeProjectSettings() {
    const activeForm = document.querySelector<HTMLFormElement>(".project-settings-card form");
    const formIsBusy = activeForm?.getAttribute("aria-busy") === "true";
    const formIsDirty = activeForm?.dataset.projectFormDirty === "true";
    if (projectFormInteraction.isBusy || formIsBusy) {
      return;
    }
    if (
      (projectFormInteraction.isDirty || formIsDirty) &&
      !window.confirm("저장하지 않은 프로젝트 변경사항이 있습니다. 닫을까요?")
    ) {
      return;
    }
    finishProjectSettings();
  }

  function closeTaskModal() {
    setTaskModalState(null);
    setTaskFormInteraction({ isDirty: false, isBusy: false });
  }

  async function handleCreateProjectTask(input: TaskFormInput) {
    if (!selectedProject) {
      return;
    }

    await createTask({
      ...input,
      projectId: selectedProject.id,
    });
    closeTaskModal();
    setTaskFormSerial((prev) => prev + 1);
  }

  async function handleUpdateProjectTask(input: TaskFormInput) {
    if (!editingTask) {
      return;
    }

    await updateTask(editingTask.id, input);
    closeTaskModal();
  }

  async function handleAutoSaveProjectTask(input: TaskFormInput) {
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
    closeTaskModal();
  }

  function changeTaskStatus(task: Task, status: TaskStatus) {
    void updateTask(task.id, toTaskInput(task, status, task.projectId));
  }

  function openTaskContextMenu(event: MouseEvent<HTMLElement>, task: Task) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      taskId: task.id,
    });
  }

  function openAiSchedule(initialDraft: string) {
    window.dispatchEvent(
      new CustomEvent("ai-planner:open-ai-schedule", {
        detail: { initialDraft },
      }),
    );
  }

  function duplicateTask(task: Task) {
    void createTask({
      ...toTaskInput(task),
      title: `${task.title} 복사본`,
    });
  }

  function deleteTaskFromContextMenu(task: Task) {
    if (!window.confirm(`"${task.title}" 일정을 삭제할까요?`)) {
      return;
    }
    void removeTask(task.id);
  }

  function getContextMenuItems(): ContextMenuItem[] {
    if (!contextTask) {
      return [];
    }

    const dateLabel = formatDateTime(contextTask.startAt, setting.timeFormat);
    const endLabel = contextTask.endAt ? ` - ${formatDateTime(contextTask.endAt, setting.timeFormat)}` : "";

    return [
      {
        id: contextTask.status === "DONE" ? "reopen-task" : "complete-task",
        label: contextTask.status === "DONE" ? "미완료로 변경" : "완료하기",
        description: contextTask.status === "DONE" ? "완료된 일정을 미완료로 복구" : "일정을 완료 상태로 변경",
        tone: "primary",
        onSelect: () => changeTaskStatus(contextTask, contextTask.status === "DONE" ? "NOT_DONE" : "DONE"),
      },
      {
        id: contextTask.status === "CANCELED" ? "restore-task" : "cancel-task",
        label: contextTask.status === "CANCELED" ? "미완료로 변경" : "취소하기",
        description: contextTask.status === "CANCELED" ? "취소된 일정을 미완료로 복구" : "일정을 취소 상태로 변경",
        tone: contextTask.status === "CANCELED" ? "default" : "danger",
        onSelect: () => changeTaskStatus(contextTask, contextTask.status === "CANCELED" ? "NOT_DONE" : "CANCELED"),
      },
      {
        id: "ai-edit-task",
        label: "AI 일정 수정",
        description: "이 일정을 기준으로 수정 요청",
        onSelect: () =>
          openAiSchedule(
            `다음 기존 일정을 수정해줘.\n- 날짜/시간: ${dateLabel}${endLabel}\n- 제목: ${contextTask.title}\n- 상태: ${
              STATUS_LABELS[contextTask.status]
            }\n\n수정 요청: `,
          ),
      },
      {
        id: "duplicate-task",
        label: "복제",
        description: "같은 내용의 새 일정 만들기",
        onSelect: () => duplicateTask(contextTask),
      },
      {
        id: "delete-task",
        label: "삭제",
        description: "확인 후 일정 삭제",
        tone: "danger",
        onSelect: () => deleteTaskFromContextMenu(contextTask),
      },
    ];
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
    setSelectedTaskTypeIds([]);
    setOverviewFilter("active");
    setContextMenu(null);
  }

  return (
    <div className="projects-workspace">
      <section className="projects-overview">
        <div>
          <p className="eyebrow">PROJECTS</p>
          <h2>프로젝트</h2>
          <p className="description-text">
            프로젝트별 진행 상황을 먼저 보고, 필요한 프로젝트 안에서 일정을 관리합니다. 카드를 드래그하면 순서를 바꿀 수
            있어요.
          </p>
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
              className={`project-summary-card ${selectedProject?.id === project.id ? "selected" : ""} ${
                dragProjectId === project.id ? "dragging" : ""
              } ${dragOverProjectId === project.id && dragProjectId !== project.id ? "drag-over" : ""}`}
              onClick={() => selectProject(project.id)}
              draggable={isDragEnabled}
              title={isDragEnabled ? "드래그해서 순서 변경" : undefined}
              onDragStart={(event) => {
                setDragProjectId(project.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", project.id);
              }}
              onDragOver={(event) => {
                if (dragProjectId && dragProjectId !== project.id) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverProjectId(project.id);
                }
              }}
              onDragLeave={() => {
                setDragOverProjectId((prev) => (prev === project.id ? null : prev));
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleProjectDrop(project.id);
              }}
              onDragEnd={() => {
                setDragProjectId(null);
                setDragOverProjectId(null);
              }}
            >
              <span className="project-color-bar" style={{ backgroundColor: project.color }} />
              <span className="project-card-title">
                <strong>{project.name}</strong>
                <small>{project.isActive ? "사용 중" : "비활성"}</small>
              </span>
              <span className="project-card-metrics">
                <span className="project-card-metric-total">전체 {stats.total}</span>
                <span className="project-card-metric-active">진행 {stats.active}</span>
                <span className="project-card-metric-week">이번 주 {stats.week}</span>
                <span className="project-card-metric-completion">완료율 {stats.completion}%</span>
                {stats.conflicts > 0 ? <span className="project-card-metric-conflict">충돌 {stats.conflicts}</span> : null}
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

              <div className="type-filter-group" aria-label="종류 필터">
                <span>종류</span>
                <div className="type-filter-options">
                  <label className={`type-filter-chip ${selectedTaskTypeIds.length === 0 ? "active" : ""}`}>
                    <input type="checkbox" checked={selectedTaskTypeIds.length === 0} onChange={() => setSelectedTaskTypeIds([])} />
                    전체
                  </label>
                  {sortedTaskTypes.map((type) => {
                    const isSelected = selectedTaskTypeIds.includes(type.id);
                    return (
                      <label key={type.id} className={`type-filter-chip ${isSelected ? "active" : ""}`}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => {
                            setSelectedTaskTypeIds((prev) => {
                              if (event.target.checked) {
                                return [...prev, type.id];
                              }
                              return prev.filter((id) => id !== type.id);
                            });
                          }}
                        />
                        {type.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="task-stack">
              {(projectStats[selectedProject.id]?.total ?? 0) === 0 ? (
                <div className="empty-state project-task-empty-state">
                  <h3>아직 프로젝트 일정이 없습니다.</h3>
                  <p>첫 일정을 추가해 이 프로젝트의 다음 단계를 정해 보세요.</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setTaskFormSerial((prev) => prev + 1);
                      setTaskModalState({ mode: "create" });
                    }}
                  >
                    첫 일정 추가
                  </button>
                </div>
              ) : projectTasks.length === 0 ? (
                <div className="empty-state project-task-filter-empty-state">
                  <h3>현재 필터에 맞는 일정이 없습니다.</h3>
                  <p>검색어나 상태·종류 필터를 바꾸면 다른 일정을 확인할 수 있어요.</p>
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => {
                      setTaskKeyword("");
                      setSelectedTaskTypeIds([]);
                      setOverviewFilter("all");
                    }}
                  >
                    필터 초기화
                  </button>
                </div>
              ) : null}
              {projectTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  project={projectMap[task.projectId]}
                  taskType={typeMap[task.taskTypeId]}
                  timeFormat={setting.timeFormat}
                  hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
                  onClick={() => setTaskModalState({ mode: "edit", taskId: task.id })}
                  onContextMenu={openTaskContextMenu}
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
        <div ref={projectSettingsDialogRef} className="modal-backdrop" onClick={closeProjectSettings}>
          <div onClick={(event) => event.stopPropagation()}>
            <ProjectEditorPanel
              key={projectSettingsModal.mode === "create" ? "new-project" : editingProject?.id ?? "project"}
              initialProject={projectSettingsModal.mode === "edit" ? editingProject : undefined}
              createMode={projectSettingsModal.mode === "create"}
              subcategories={
                projectSettingsModal.mode === "edit" && editingProject
                  ? projectSubcategories.filter((sub) => sub.projectId === editingProject.id)
                  : []
              }
              onSaveProject={handleSaveProject}
              onDeleteProject={handleDeleteProject}
              onCreateSubcategory={async (projectId, name) => {
                await createSubcategory(projectId, name);
              }}
              onRenameSubcategory={renameSubcategory}
              onDeleteSubcategory={deleteSubcategory}
              onClose={closeProjectSettings}
              onCommitClose={finishProjectSettings}
              onStateChange={setProjectFormInteraction}
            />
          </div>
        </div>
      ) : null}

      {activeTaskModalState ? (
        <TaskModal
          title={activeTaskModalState.mode === "create" ? "프로젝트 일정 추가" : "프로젝트 일정 수정"}
          onCancel={closeTaskModal}
          hasUnsavedChanges={taskFormInteraction.isDirty}
          isBusy={taskFormInteraction.isBusy}
        >
          {activeTaskModalState.mode === "create" && selectedProject ? (
            <TaskForm
              key={`project-task-new-${selectedProject.id}-${taskFormSerial}`}
              projects={projects}
              taskTypes={taskTypes}
              allTasks={tasks}
              fixedProjectId={selectedProject.id}
              timeFormat={setting.timeFormat}
              onSubmit={handleCreateProjectTask}
              onCancel={closeTaskModal}
              onStateChange={setTaskFormInteraction}
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
              onAutoSave={handleAutoSaveProjectTask}
              onDelete={handleDeleteProjectTask}
              onCancel={closeTaskModal}
              onStateChange={setTaskFormInteraction}
            />
          ) : null}
        </TaskModal>
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextTask?.title}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}
