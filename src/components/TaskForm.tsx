import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, RecurrencePattern, Task, TaskFormInput, TaskStatus, TaskType } from "../models";
import { RECURRENCE_LABELS, STATUS_LABELS } from "../constants";
import {
  combineDateTimeToIso,
  formatDateTime,
  getDateKey,
  toLocalDateInputValue,
  toLocalTimeInputValue,
} from "../utils/date";
import { compareProjects } from "../utils/projectOrder";
import { findTaskConflictsForRange } from "../utils/taskConflicts";

interface TaskFormProps {
  projects: Project[];
  taskTypes: TaskType[];
  allTasks?: Task[];
  initialTask?: Task;
  defaultStartDate?: string;
  fixedProjectId?: string;
  timeFormat: "24h" | "12h";
  linkedNotes?: Array<{ id: string; title: string }>;
  onOpenNote?: (noteId: string) => void;
  onSubmit: (input: TaskFormInput) => Promise<void>;
  onAutoSave?: (input: TaskFormInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel?: () => void;
  onStateChange?: (state: TaskFormInteractionState) => void;
}

export interface TaskFormInteractionState {
  isDirty: boolean;
  isBusy: boolean;
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
  recurrencePattern: RecurrencePattern;
  recurrenceCount: string;
}

type FormField =
  | "title"
  | "content"
  | "taskTypeId"
  | "projectId"
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime";

type FormErrors = Partial<Record<FormField, string>>;

interface FormBuildResult {
  input?: TaskFormInput;
  errors: FormErrors;
}

const FIELD_FOCUS_ORDER: FormField[] = [
  "title",
  "content",
  "taskTypeId",
  "projectId",
  "startDate",
  "startTime",
  "endDate",
  "endTime",
];

const STATUS_DESCRIPTIONS: Record<TaskStatus, string> = {
  NOT_DONE: "아직 진행 중인 일정입니다.",
  ON_HOLD: "잠시 멈춰 둔 일정입니다.",
  DONE: "완료 기록에 포함되는 일정입니다.",
  CANCELED: "취소된 일정입니다.",
};

const PRIMARY_STATUS_ACTIONS: Record<
  TaskStatus,
  { target: TaskStatus; label: string; icon: string; tone: "complete" | "resume" }
> = {
  NOT_DONE: { target: "DONE", label: "완료로 변경", icon: "✓", tone: "complete" },
  ON_HOLD: { target: "NOT_DONE", label: "다시 진행", icon: "▶", tone: "resume" },
  DONE: { target: "NOT_DONE", label: "미완료로 되돌리기", icon: "↺", tone: "resume" },
  CANCELED: { target: "NOT_DONE", label: "일정 복구", icon: "↺", tone: "resume" },
};

function buildDefaultState(projects: Project[], taskTypes: TaskType[], defaultStartDate?: string): FormState {
  const now = new Date();
  const roundedStart = new Date(now);
  const minuteRemainder = now.getMinutes() % 15;
  const hasPartialMinute = now.getSeconds() > 0 || now.getMilliseconds() > 0;
  const minutesToAdd = minuteRemainder === 0 && !hasPartialMinute ? 0 : 15 - minuteRemainder;
  roundedStart.setMinutes(now.getMinutes() + minutesToAdd, 0, 0);

  const todayKey = getDateKey(now);
  const startDate = defaultStartDate && defaultStartDate !== todayKey ? defaultStartDate : getDateKey(roundedStart);
  const [year, month, day] = startDate.split("-").map(Number);
  const normalizedStart = new Date(year, month - 1, day, roundedStart.getHours(), roundedStart.getMinutes(), 0, 0);
  const defaultEnd = new Date(normalizedStart.getTime() + 60 * 60 * 1000);

  return {
    title: "",
    content: "",
    taskTypeId: taskTypes.find((item) => item.isActive)?.id ?? taskTypes[0]?.id ?? "",
    projectId: projects.find((item) => item.isActive)?.id ?? projects[0]?.id ?? "",
    status: "NOT_DONE",
    startDate: getDateKey(normalizedStart),
    startTime: toLocalTimeInputValue(normalizedStart.toISOString()),
    endDate: getDateKey(defaultEnd),
    endTime: toLocalTimeInputValue(defaultEnd.toISOString()),
    isMajor: false,
    recurrencePattern: "NONE",
    recurrenceCount: "1",
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
    recurrencePattern: task.recurrencePattern ?? "NONE",
    recurrenceCount: "1",
  };
}

function buildInputFromForm(form: FormState, fixedProjectId?: string): FormBuildResult {
  const errors: FormErrors = {};

  if (!form.title.trim()) {
    errors.title = "제목을 입력해 주세요.";
  }
  if (!form.taskTypeId) {
    errors.taskTypeId = "종류를 선택해 주세요.";
  }
  if (!form.projectId && !fixedProjectId) {
    errors.projectId = "프로젝트를 선택해 주세요.";
  }
  if (!form.startDate) {
    errors.startDate = "시작 날짜를 입력해 주세요.";
  }
  if (!form.startTime) {
    errors.startTime = "시작 시간을 입력해 주세요.";
  }
  if (form.endDate && !form.endTime) {
    errors.endTime = "종료 시간을 함께 입력해 주세요.";
  }
  if (!form.endDate && form.endTime) {
    errors.endDate = "종료 날짜를 함께 입력해 주세요.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const startAt = combineDateTimeToIso(form.startDate, form.startTime);
  const endAt = form.endDate && form.endTime ? combineDateTimeToIso(form.endDate, form.endTime) : undefined;

  if (endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    return { errors: { endTime: "종료 시간은 시작 시간보다 빠를 수 없습니다." } };
  }

  const recurrenceCount = Math.max(1, Math.min(60, Math.floor(Number(form.recurrenceCount) || 1)));

  return {
    errors: {},
    input: {
      title: form.title,
      content: form.content,
      taskTypeId: form.taskTypeId,
      projectId: fixedProjectId ?? form.projectId,
      status: form.status,
      startAt,
      endAt,
      isMajor: form.isMajor,
      recurrencePattern: form.recurrencePattern,
      recurrenceCount,
    },
  };
}

function serializeTaskMetadataForm(form: FormState, fixedProjectId?: string): string {
  return JSON.stringify({
    taskTypeId: form.taskTypeId,
    projectId: fixedProjectId ?? form.projectId,
    status: form.status,
    startDate: form.startDate,
    startTime: form.startTime,
    endDate: form.endDate,
    endTime: form.endTime,
    isMajor: form.isMajor,
  });
}

function buildAutoSaveInputFromForm(
  form: FormState,
  initialTask: Task,
  fixedProjectId?: string,
): FormBuildResult {
  return buildInputFromForm(
    {
      ...form,
      title: initialTask.title,
      content: initialTask.content,
    },
    fixedProjectId,
  );
}

export function TaskForm({
  projects,
  taskTypes,
  allTasks = [],
  initialTask,
  defaultStartDate,
  fixedProjectId,
  timeFormat,
  linkedNotes = [],
  onOpenNote,
  onSubmit,
  onAutoSave,
  onDelete,
  onCancel,
  onStateChange,
}: TaskFormProps) {
  // 프로젝트 탭에서 정한 표시 순서를 선택리스트에도 그대로 적용한다
  const orderedProjects = useMemo(() => [...projects].sort(compareProjects), [projects]);
  const isEdit = Boolean(initialTask);
  const [form, setForm] = useState<FormState>(() => {
    return initialTask ? buildStateFromTask(initialTask) : buildDefaultState(orderedProjects, taskTypes, defaultStartDate);
  });
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [autoSaveMessage, setAutoSaveMessage] = useState(() =>
    initialTask && onAutoSave ? "선택 항목은 변경 즉시 저장됩니다." : "",
  );
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(() =>
    Boolean(isEdit && (initialTask?.endAt || initialTask?.isMajor || initialTask?.recurrenceGroupId)),
  );

  const formRef = useRef<HTMLFormElement>(null);
  const initialFormSnapshotRef = useRef(JSON.stringify(form));
  const initialMetadataSnapshot = serializeTaskMetadataForm(form, fixedProjectId);
  const [savedMetadataSnapshot, setSavedMetadataSnapshot] = useState(initialMetadataSnapshot);
  const lastQueuedMetadataSnapshotRef = useRef(initialMetadataSnapshot);
  const autoSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAutoSaveCountRef = useRef(0);
  const currentMetadataSnapshot = serializeTaskMetadataForm(form, fixedProjectId);
  const isTextDirty = initialTask
    ? form.title !== initialTask.title || form.content !== initialTask.content
    : false;
  const isMetadataDirty = initialTask ? currentMetadataSnapshot !== savedMetadataSnapshot : false;
  const isDirty = initialTask
    ? isTextDirty || isMetadataDirty
    : JSON.stringify(form) !== initialFormSnapshotRef.current;
  const isBusy = isSubmitting || isDeleting || isAutoSaving;

  const statusOptions = useMemo(
    () =>
      (Object.keys(STATUS_LABELS) as TaskStatus[]).map((status) => ({
        value: status,
        label: STATUS_LABELS[status],
      })),
    [],
  );
  const primaryStatusAction = PRIMARY_STATUS_ACTIONS[form.status];
  const alternativeStatusOptions = statusOptions.filter(
    (item) => item.value !== form.status && item.value !== primaryStatusAction.target,
  );

  const draftRange = useMemo(() => {
    if (!form.startDate || !form.startTime) {
      return undefined;
    }

    const startAt = combineDateTimeToIso(form.startDate, form.startTime);
    const endAt = form.endDate && form.endTime ? combineDateTimeToIso(form.endDate, form.endTime) : undefined;
    return { startAt, endAt };
  }, [form.startDate, form.startTime, form.endDate, form.endTime]);

  const conflictingTasks = useMemo(() => {
    if (!draftRange) {
      return [];
    }

    return findTaskConflictsForRange(allTasks, draftRange.startAt, draftRange.endAt, initialTask?.id);
  }, [allTasks, draftRange, initialTask?.id]);

  const advancedSummary = useMemo(() => {
    const endSummary =
      form.endDate && form.endTime
        ? form.endDate === form.startDate
          ? `종료 ${form.endTime}`
          : `종료 ${form.endDate} ${form.endTime}`
        : "종료 없음";
    const recurrenceSummary = isEdit
      ? initialTask?.recurrenceGroupId
        ? RECURRENCE_LABELS[initialTask.recurrencePattern ?? "NONE"]
        : ""
      : form.recurrencePattern !== "NONE"
        ? RECURRENCE_LABELS[form.recurrencePattern]
        : "";
    return [endSummary, recurrenceSummary].filter(Boolean).join(" · ");
  }, [form.endDate, form.endTime, form.recurrencePattern, form.startDate, initialTask, isEdit]);

  useEffect(() => {
    onStateChange?.({ isDirty, isBusy });
  }, [isBusy, isDirty, onStateChange]);

  useEffect(() => {
    if (!initialTask || !onAutoSave || currentMetadataSnapshot === lastQueuedMetadataSnapshotRef.current) {
      return;
    }

    const built = buildAutoSaveInputFromForm(form, initialTask, fixedProjectId);
    if (!built.input) {
      setAutoSaveMessage("입력을 마치면 자동 저장됩니다.");
      return;
    }

    const snapshot = currentMetadataSnapshot;
    const input = built.input;
    lastQueuedMetadataSnapshotRef.current = snapshot;
    pendingAutoSaveCountRef.current += 1;
    setIsAutoSaving(true);
    setAutoSaveMessage("자동 저장 중…");
    setSubmitError("");

    autoSaveQueueRef.current = autoSaveQueueRef.current.then(async () => {
      try {
        await onAutoSave(input);
        setSavedMetadataSnapshot(snapshot);
        if (snapshot === lastQueuedMetadataSnapshotRef.current) {
          setAutoSaveMessage("자동 저장됨");
          setSubmitError("");
        }
      } catch (autoSaveError) {
        if (snapshot === lastQueuedMetadataSnapshotRef.current) {
          setAutoSaveMessage("자동 저장 실패");
          setSubmitError(autoSaveError instanceof Error ? autoSaveError.message : "일정 자동 저장에 실패했습니다.");
        }
      } finally {
        pendingAutoSaveCountRef.current = Math.max(0, pendingAutoSaveCountRef.current - 1);
        if (pendingAutoSaveCountRef.current === 0) {
          setIsAutoSaving(false);
        }
      }
    });
  }, [currentMetadataSnapshot, fixedProjectId, form, initialTask, onAutoSave]);

  const firstErrorField = FIELD_FOCUS_ORDER.find((field) => Boolean(fieldErrors[field]));

  useEffect(() => {
    if (!firstErrorField) {
      return;
    }

    if (firstErrorField === "endDate" || firstErrorField === "endTime") {
      setIsAdvancedOpen(true);
    }

    const frameId = window.requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>(`[name="${firstErrorField}"]`)?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [firstErrorField]);

  function updateFormField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors({});
    setSubmitError("");
  }

  function errorId(field: FormField) {
    return `task-form-${field}-error`;
  }

  function errorProps(field: FormField) {
    const message = fieldErrors[field];
    return {
      "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? errorId(field) : undefined,
    };
  }

  function renderFieldError(field: FormField) {
    const message = fieldErrors[field];
    return message ? (
      <span id={errorId(field)} className="task-form-field-error error-text">
        {message}
      </span>
    ) : null;
  }

  function renderStatusControl() {
    return (
      <section className="task-status-quick-control" aria-label="일정 상태">
        <div className="task-status-current-copy">
          <div className="task-status-current-line">
            <span>{isEdit ? "현재 상태" : "시작 상태"}</span>
            <strong
              className={`status-badge ${form.status.toLowerCase()}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {STATUS_LABELS[form.status]}
            </strong>
          </div>
          <p>{STATUS_DESCRIPTIONS[form.status]}</p>
        </div>

        <div className="task-status-quick-actions">
          <button
            type="button"
            className={`task-status-primary-action ${primaryStatusAction.tone}`}
            onClick={() => void handlePrimaryStatusAction()}
            aria-label={`상태를 ${STATUS_LABELS[primaryStatusAction.target]}로 변경하고 자동 저장`}
            disabled={isBusy}
          >
            <span className="task-status-action-icon" aria-hidden="true">
              {primaryStatusAction.icon}
            </span>
            <span>{primaryStatusAction.label}</span>
          </button>

          <label className="task-status-alternate-select">
            <span className="sr-only">다른 상태로 변경</span>
            <select
              value=""
              aria-label="다른 상태로 변경"
              disabled={isBusy}
              onChange={(event) => {
                const nextStatus = event.target.value as TaskStatus;
                if (nextStatus) {
                  updateFormField("status", nextStatus);
                }
              }}
            >
              <option value="" disabled>
                다른 상태
              </option>
              {alternativeStatusOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
    );
  }

  async function submitForm(nextForm: FormState) {
    if (isBusy) {
      return;
    }

    setSubmitError("");

    const built = buildInputFromForm(nextForm, fixedProjectId);
    if (!built.input) {
      setFieldErrors(built.errors);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    try {
      await onSubmit(built.input);
    } catch (submitError) {
      setSubmitError(submitError instanceof Error ? submitError.message : "일정 저장에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePrimaryStatusAction() {
    const nextStatus = primaryStatusAction.target;
    updateFormField("status", nextStatus);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitForm(form);
  }

  async function handleDelete() {
    if (!onDelete) {
      return;
    }

    setSubmitError("");
    setIsDeleting(true);
    try {
      await onDelete();
    } catch (deleteError) {
      setSubmitError(deleteError instanceof Error ? deleteError.message : "일정 삭제에 실패했습니다.");
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCancel() {
    if (isBusy) {
      return;
    }
    if (isDirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 닫을까요?")) {
      return;
    }
    onCancel?.();
  }

  function handleOpenLinkedNote(noteId: string) {
    if (isBusy) {
      return;
    }
    if (isDirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 노트로 이동할까요?")) {
      return;
    }
    onOpenNote?.(noteId);
  }

  return (
    <form
      ref={formRef}
      className="task-form task-form-main task-form-redesigned"
      onSubmit={handleSubmit}
      aria-label={isEdit ? "일정 수정 폼" : "일정 추가 폼"}
      aria-busy={isBusy}
      data-task-form-dirty={isDirty ? "true" : "false"}
      noValidate
    >
      <fieldset className="task-form-section task-form-primary-section">
        <legend>
          기본 정보 <span className="task-form-required-hint">* 필수</span>
        </legend>

        <label className="task-form-field">
          <span>
            제목 <span className="task-form-required-mark" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            name="title"
            value={form.title}
            onChange={(event) => updateFormField("title", event.target.value)}
            placeholder="무엇을 할 예정인가요?"
            data-task-modal-initial-focus
            required
            aria-required="true"
            {...errorProps("title")}
          />
          {renderFieldError("title")}
        </label>

        {isEdit ? renderStatusControl() : null}

        <label className="task-form-field">
          <span>
            내용 <span className="task-form-optional-hint" aria-hidden="true">선택</span>
          </span>
          <textarea
            name="content"
            value={form.content}
            onChange={(event) => updateFormField("content", event.target.value)}
            placeholder="준비할 내용이나 완료 기준을 적어 주세요."
            rows={3}
            {...errorProps("content")}
          />
          {renderFieldError("content")}
        </label>

        <div className="form-grid two-col task-form-classification-grid">
          <label className="task-form-field">
            <span>
              종류 <span className="task-form-required-mark" aria-hidden="true">*</span>
            </span>
            <select
              name="taskTypeId"
              value={form.taskTypeId}
              onChange={(event) => updateFormField("taskTypeId", event.target.value)}
              required
              aria-required="true"
              {...errorProps("taskTypeId")}
            >
              {taskTypes
                .filter((item) => item.isActive || item.id === form.taskTypeId)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
            </select>
            {renderFieldError("taskTypeId")}
          </label>

          {fixedProjectId ? (
            <label className="task-form-field">
              <span>
                프로젝트 <span className="task-form-required-mark" aria-hidden="true">*</span>
              </span>
              <input
                type="text"
                name="projectId"
                value={projects.find((project) => project.id === fixedProjectId)?.name ?? "선택된 프로젝트"}
                readOnly
              />
            </label>
          ) : (
            <label className="task-form-field">
              <span>
                프로젝트 <span className="task-form-required-mark" aria-hidden="true">*</span>
              </span>
              <select
                name="projectId"
                value={form.projectId}
                onChange={(event) => updateFormField("projectId", event.target.value)}
                required
                aria-required="true"
                {...errorProps("projectId")}
              >
                {orderedProjects
                  .filter((item) => item.isActive || item.id === form.projectId)
                  .map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
              </select>
              {renderFieldError("projectId")}
            </label>
          )}
        </div>

        <div className="form-grid two-col task-form-datetime-grid" role="group" aria-label="시작 일시">
          <label className="task-form-field">
            <span>
              시작 날짜 <span className="task-form-required-mark" aria-hidden="true">*</span>
            </span>
            <input
              type="date"
              name="startDate"
              value={form.startDate}
              onChange={(event) => updateFormField("startDate", event.target.value)}
              required
              aria-required="true"
              {...errorProps("startDate")}
            />
            {renderFieldError("startDate")}
          </label>

          <label className="task-form-field">
            <span>
              시작 시간 <span className="task-form-required-mark" aria-hidden="true">*</span>
            </span>
            <input
              type="time"
              name="startTime"
              value={form.startTime}
              onChange={(event) => updateFormField("startTime", event.target.value)}
              step={900}
              required
              aria-required="true"
              {...errorProps("startTime")}
            />
            {renderFieldError("startTime")}
          </label>
        </div>
        {draftRange ? (
          <p className="task-form-time-preview">
            {timeFormat === "24h" ? "24시간 기준" : "12시간 기준"} · {formatDateTime(draftRange.startAt, timeFormat)}
            {draftRange.endAt ? ` → ${formatDateTime(draftRange.endAt, timeFormat)}` : ""}
          </p>
        ) : null}
      </fieldset>

      <details
        className="task-form-section task-form-advanced task-form-advanced-options"
        open={isAdvancedOpen}
        onToggle={(event) => setIsAdvancedOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="task-form-advanced-summary-copy">
            <strong>고급 옵션</strong>
            <small>{advancedSummary}</small>
          </span>
        </summary>

        <div className="task-form-advanced-content">
          <div className="form-grid two-col task-form-datetime-grid" role="group" aria-label="종료 일시">
            <label className="task-form-field">
              종료 날짜
              <input
                type="date"
                name="endDate"
                value={form.endDate}
                onChange={(event) => updateFormField("endDate", event.target.value)}
                {...errorProps("endDate")}
              />
              {renderFieldError("endDate")}
            </label>
            <label className="task-form-field">
              종료 시간
              <input
                type="time"
                name="endTime"
                value={form.endTime}
                onChange={(event) => updateFormField("endTime", event.target.value)}
                step={900}
                {...errorProps("endTime")}
              />
              {renderFieldError("endTime")}
            </label>
          </div>

          {!isEdit ? (
            <div className="form-grid two-col task-form-recurrence-grid">
              <label className="task-form-field">
                반복
                <select
                  value={form.recurrencePattern}
                  onChange={(event) => {
                    const nextPattern = event.target.value as RecurrencePattern;
                    setForm((prev) => ({
                      ...prev,
                      recurrencePattern: nextPattern,
                      recurrenceCount: nextPattern === "NONE" ? "1" : prev.recurrenceCount,
                    }));
                    setSubmitError("");
                  }}
                >
                  {(Object.keys(RECURRENCE_LABELS) as RecurrencePattern[]).map((pattern) => (
                    <option key={pattern} value={pattern}>
                      {RECURRENCE_LABELS[pattern]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="task-form-field">
                생성 횟수
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.recurrenceCount}
                  onChange={(event) => updateFormField("recurrenceCount", event.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="1"
                  disabled={form.recurrencePattern === "NONE"}
                />
              </label>
            </div>
          ) : null}

          {isEdit && initialTask?.recurrenceGroupId ? (
            <div className="task-form-recurrence-note" role="note">
              <strong>{RECURRENCE_LABELS[initialTask.recurrencePattern ?? "NONE"]} 반복 일정</strong>
              <span>
                {typeof initialTask.recurrenceIndex === "number" ? `${initialTask.recurrenceIndex + 1}번째 항목입니다. ` : ""}
                이번 일정만 수정되며 다른 반복 항목은 유지됩니다.
              </span>
            </div>
          ) : null}

          <label className="checkbox-inline task-form-major-toggle">
            <input
              type="checkbox"
              checked={form.isMajor}
              onChange={(event) => updateFormField("isMajor", event.target.checked)}
            />
            주요 일정으로 표시
          </label>

        </div>
      </details>

      {conflictingTasks.length > 0 ? (
        <div className="conflict-warning" role="alert" aria-live="polite">
          <strong>시간 충돌 {conflictingTasks.length}건</strong>
          <ul className="conflict-list">
            {conflictingTasks.slice(0, 5).map((task) => (
              <li key={task.id}>
                {task.title} ({formatDateTime(task.startAt, timeFormat)}
                {task.endAt ? ` - ${formatDateTime(task.endAt, timeFormat)}` : ""})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isEdit && linkedNotes.length > 0 ? (
        <div className="task-linked-notes">
          <span className="task-linked-notes-label">연결된 노트</span>
          <div className="task-linked-notes-chips">
            {linkedNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                className="task-linked-note-chip"
                onClick={() => handleOpenLinkedNote(note.id)}
                title="노트로 이동"
              >
                📄 {note.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {initialTask ? (
        <div className="meta-row">
          <span>{`생성일: ${formatDateTime(initialTask.createdAt, timeFormat)}`}</span>
          <span>{`수정일: ${formatDateTime(initialTask.updatedAt, timeFormat)}`}</span>
        </div>
      ) : null}

      {submitError ? (
        <p className="error-text" role="alert">
          {submitError}
        </p>
      ) : null}

      {isEdit && onAutoSave ? (
        <p className="description-text task-form-autosave-status" role="status" aria-live="polite">
          {autoSaveMessage}
        </p>
      ) : null}

      <div className="button-row task-form-actions task-form-footer">
        {isEdit && onDelete ? (
          <button
            className="btn btn-danger"
            type="button"
            onClick={() => void handleDelete()}
            disabled={isBusy}
          >
            {isDeleting ? "삭제 중…" : "일정 삭제"}
          </button>
        ) : null}
        <div className="task-form-actions-primary">
          {onCancel ? (
            <button className="btn btn-soft" type="button" onClick={handleCancel} disabled={isBusy}>
              취소
            </button>
          ) : null}
          <button className="btn btn-primary" type="submit" disabled={isBusy}>
            {isSubmitting ? "저장 중…" : isEdit ? "변경사항 저장" : "일정 추가"}
          </button>
        </div>
      </div>
    </form>
  );
}
