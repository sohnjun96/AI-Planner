import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, Task, TaskFormInput, TaskStatus, TaskType } from "../models";
import { STATUS_LABELS } from "../constants";
import {
  combineDateTimeToIso,
  formatDateTime,
  getDateKey,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from "../utils/date";

interface TaskFormProps {
  projects: Project[];
  taskTypes: TaskType[];
  initialTask?: Task;
  defaultStartDate?: string;
  fixedProjectId?: string;
  timeFormat: "24h" | "12h";
  onSubmit: (input: TaskFormInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
}

interface FormState {
  title: string;
  content: string;
  taskTypeId: string;
  projectId: string;
  status: TaskStatus;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  isMajor: boolean;
}

const AUTOSAVE_DELAY_MS = 700;

function buildDefaultState(projects: Project[], taskTypes: TaskType[], defaultStartDate?: string): FormState {
  const now = new Date();
  const date = defaultStartDate ?? getDateKey(now);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return {
    title: "",
    content: "",
    taskTypeId: taskTypes.find((item) => item.isActive)?.id ?? taskTypes[0]?.id ?? "",
    projectId: projects.find((item) => item.isActive)?.id ?? projects[0]?.id ?? "",
    status: "NOT_DONE",
    startDate: date,
    startTime: time,
    endDate: "",
    endTime: "",
    isMajor: false,
  };
}

function buildStateFromTask(task: Task): FormState {
  return {
    title: task.title,
    content: task.content,
    taskTypeId: task.taskTypeId,
    projectId: task.projectId,
    status: task.status,
    startDate: toLocalDateInputValue(task.startAt),
    startTime: toLocalTimeInputValue(task.startAt),
    endDate: task.endAt ? toLocalDateInputValue(task.endAt) : "",
    endTime: task.endAt ? toLocalTimeInputValue(task.endAt) : "",
    isMajor: task.isMajor,
  };
}

function buildInputFromForm(form: FormState, fixedProjectId?: string): { input?: TaskFormInput; error?: string } {
  if (!form.title.trim()) {
    return { error: "제목을 입력해 주세요." };
  }
  if (!form.taskTypeId) {
    return { error: "종류를 선택해 주세요." };
  }
  if (!form.projectId && !fixedProjectId) {
    return { error: "프로젝트를 선택해 주세요." };
  }
  if (!form.startDate || !form.startTime) {
    return { error: "날짜와 시간을 입력해 주세요." };
  }
  if ((form.endDate && !form.endTime) || (!form.endDate && form.endTime)) {
    return { error: "종료 날짜와 종료 시간은 함께 입력해 주세요." };
  }

  const startAt = combineDateTimeToIso(form.startDate, form.startTime);
  const endAt = form.endDate && form.endTime ? combineDateTimeToIso(form.endDate, form.endTime) : undefined;

  if (endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    return { error: "종료 시간은 시작 시간보다 빠를 수 없습니다." };
  }

  return {
    input: {
      title: form.title,
      content: form.content,
      taskTypeId: form.taskTypeId,
      projectId: fixedProjectId ?? form.projectId,
      status: form.status,
      startAt,
      endAt,
      isMajor: form.isMajor,
    },
  };
}

function serializeTaskInput(input: TaskFormInput): string {
  return JSON.stringify({
    title: input.title.trim(),
    content: input.content.trim(),
    taskTypeId: input.taskTypeId,
    projectId: input.projectId,
    status: input.status,
    startAt: input.startAt,
    endAt: input.endAt ?? "",
    isMajor: input.isMajor,
  });
}

export function TaskForm({
  projects,
  taskTypes,
  initialTask,
  defaultStartDate,
  fixedProjectId,
  timeFormat,
  onSubmit,
  onDelete,
  onCancel,
}: TaskFormProps) {
  const [form, setForm] = useState<FormState>(() => {
    return initialTask ? buildStateFromTask(initialTask) : buildDefaultState(projects, taskTypes, defaultStartDate);
  });
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoSaveMessage, setAutoSaveMessage] = useState("");

  const isEdit = Boolean(initialTask);
  const autoSaveSnapshotRef = useRef("");

  const statusOptions = useMemo(
    () =>
      (Object.keys(STATUS_LABELS) as TaskStatus[]).map((status) => ({
        value: status,
        label: STATUS_LABELS[status],
      })),
    [],
  );

  useEffect(() => {
    if (!isEdit) {
      autoSaveSnapshotRef.current = "";
      return;
    }

    const built = buildInputFromForm(form, fixedProjectId);
    if (built.input) {
      autoSaveSnapshotRef.current = serializeTaskInput(built.input);
    }
  }, [isEdit, initialTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isEdit) {
      return;
    }

    const built = buildInputFromForm(form, fixedProjectId);
    if (!built.input) {
      return;
    }

    const snapshot = serializeTaskInput(built.input);
    if (snapshot === autoSaveSnapshotRef.current) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void onSubmit(built.input as TaskFormInput)
        .then(() => {
          autoSaveSnapshotRef.current = snapshot;
          setAutoSaveMessage("자동 저장됨");
        })
        .catch((submitError) => {
          setError(submitError instanceof Error ? submitError.message : "일정 저장에 실패했습니다.");
        });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isEdit, form, fixedProjectId, onSubmit]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const built = buildInputFromForm(form, fixedProjectId);
    if (!built.input) {
      setError(built.error ?? "일정 입력값이 올바르지 않습니다.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(built.input);
      autoSaveSnapshotRef.current = serializeTaskInput(built.input);
      setAutoSaveMessage("저장됨");

      if (!isEdit) {
        setForm(buildDefaultState(projects, taskTypes, defaultStartDate));
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "일정 저장에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <h3>{isEdit ? "일정 수정" : "일정 추가"}</h3>

      <label>
        제목
        <input
          type="text"
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="일정 제목"
          required
        />
      </label>

      <label>
        내용
        <textarea
          value={form.content}
          onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
          placeholder="일정 상세 내용"
          rows={4}
        />
      </label>

      <div className="form-grid two-col">
        <label>
          종류
          <select
            value={form.taskTypeId}
            onChange={(event) => setForm((prev) => ({ ...prev, taskTypeId: event.target.value }))}
          >
            {taskTypes
              .filter((item) => item.isActive || item.id === form.taskTypeId)
              .map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
          </select>
        </label>

        {fixedProjectId ? (
          <label>
            프로젝트
            <input
              type="text"
              value={projects.find((project) => project.id === fixedProjectId)?.name ?? "선택된 프로젝트"}
              readOnly
            />
          </label>
        ) : (
          <label>
            프로젝트
            <select
              value={form.projectId}
              onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}
            >
              {projects
                .filter((item) => item.isActive || item.id === form.projectId)
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      <div className="status-toggle-block">
        <span>상태</span>
        <div className="status-toggle-group">
          {statusOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`status-toggle-btn ${item.value.toLowerCase()} ${form.status === item.value ? "active" : ""}`}
              onClick={() => {
                setForm((prev) => ({ ...prev, status: item.value }));
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-grid two-col">
        <label>
          시작 날짜
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
          />
        </label>

        <label>
          시작 시간
          <input
            type="time"
            value={form.startTime}
            onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))}
          />
        </label>
      </div>

      <div className="form-grid two-col">
        <label>
          종료 날짜
          <input
            type="date"
            value={form.endDate}
            onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
          />
        </label>
        <label>
          종료 시간
          <input
            type="time"
            value={form.endTime}
            onChange={(event) => setForm((prev) => ({ ...prev, endTime: event.target.value }))}
          />
        </label>
      </div>

      <label className="checkbox-inline">
        <input
          type="checkbox"
          checked={form.isMajor}
          onChange={(event) => setForm((prev) => ({ ...prev, isMajor: event.target.checked }))}
        />
        {"\uC8FC\uC694 \uC77C\uC815"}
      </label>

      {initialTask ? (
        <div className="meta-row">
          <span>{`생성일: ${formatDateTime(initialTask.createdAt, timeFormat)}`}</span>
          <span>{`수정일: ${formatDateTime(initialTask.updatedAt, timeFormat)}`}</span>
        </div>
      ) : null}

      {isEdit ? <p className="success-text">{autoSaveMessage || "자동 저장 켜짐"}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="button-row">
        <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
          {isEdit ? "저장" : "추가"}
        </button>
        {isEdit && onDelete ? (
          <button
            className="btn btn-danger"
            type="button"
            onClick={() => {
              void onDelete();
            }}
          >
            삭제
          </button>
        ) : null}
        {isEdit && onCancel ? (
          <button className="btn btn-soft" type="button" onClick={onCancel}>
            취소
          </button>
        ) : null}
      </div>
    </form>
  );
}
