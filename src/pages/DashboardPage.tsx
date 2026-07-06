import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { DailyBriefing } from "../components/DailyBriefing";
import { MarkdownMemo } from "../components/MarkdownMemo";
import { MonthCalendar, type CalendarDayMarker, type CalendarDaySummary } from "../components/MonthCalendar";
import { TaskForm } from "../components/TaskForm";
import { TaskViewSegmentedControl } from "../components/TaskViewSegmentedControl";
import { DEFAULT_PROJECT_ID, LUNCH_PROJECT_ID, STATUS_LABELS } from "../constants";
import type { TaskViewMode } from "../constants/taskViewModes";
import { useAppData } from "../context/AppDataContext";
import type { Project, Task, TaskFormInput, TaskStatus, TaskType } from "../models";
import {
  addDays,
  combineDateTimeToIso,
  compareByStartAtAsc,
  getDateKey,
  isPastCompletedHidden,
  shiftIsoToDateKey,
} from "../utils/date";
import { buildTaskConflictMap } from "../utils/taskConflicts";
import { isTaskActive, isTaskCanceled, isTaskDone, isTaskVisibleOnBoard } from "../utils/taskStatus";

const GLOBAL_MEMO_KEY = "global";

type TaskModalState =
  | {
      mode: "create";
      defaultDate?: string;
    }
  | {
      mode: "edit";
      taskId: string;
    }
  | null;

type AgendaViewMode = "priority" | "all";

type DashboardContextMenu =
  | {
      kind: "date";
      x: number;
      y: number;
      dateKey: string;
    }
  | {
      kind: "task";
      x: number;
      y: number;
      taskId: string;
    };

const EMPTY_DAY_SUMMARY: CalendarDaySummary = {
  total: 0,
  done: 0,
  canceled: 0,
  pending: 0,
  onHold: 0,
  conflicts: 0,
  major: 0,
  lunch: 0,
  markers: [],
  titles: [],
};

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

function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(dateKey));
}

function formatContextDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${dateKey}T00:00:00`));
}

function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
}

function formatTimeOnly(value: string, timeFormat: "24h" | "12h"): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(new Date(value));
}

function formatTaskTime(task: Task, timeFormat: "24h" | "12h"): string {
  const startTime = formatTimeOnly(task.startAt, timeFormat);
  return task.endAt ? `${startTime} - ${formatTimeOnly(task.endAt, timeFormat)}` : startTime;
}

function formatShortDateTime(value: string): string {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}.${day}. ${hours}:${minutes}`;
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = color.trim().replace("#", "");
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((value) => `${value}${value}`)
          .join("")
      : hex;

  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return color;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getCalendarDetailProjectStyle(project?: Project): CSSProperties {
  const projectColor = project?.color ?? "#64748b";
  return {
    "--calendar-detail-project-color": projectColor,
    "--calendar-detail-project-bg": colorWithAlpha(projectColor, 0.13),
    "--calendar-detail-project-border": colorWithAlpha(projectColor, 0.38),
  } as CSSProperties;
}

function compareByStatusThenStartAt(a: Task, b: Task): number {
  const rank = (status: TaskStatus) => {
    if (status === "NOT_DONE") {
      return 0;
    }
    if (status === "ON_HOLD") {
      return 1;
    }
    if (status === "DONE") {
      return 2;
    }
    return 3;
  };
  const rankDiff = rank(a.status) - rank(b.status);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  return compareByStartAtAsc(a, b);
}

function isSubmissionTaskType(task: Task, typeMap: Record<string, TaskType | undefined>): boolean {
  const taskType = typeMap[task.taskTypeId];
  if (!taskType) {
    return false;
  }
  return taskType.name.trim().toLowerCase() === "제출";
}

const LUNCH_TASK_KEYWORDS = ["점심", "중식", "lunch"];

function isLunchTask(
  task: Task,
  typeMap: Record<string, TaskType | undefined>,
  projectMap: Record<string, Project | undefined>,
): boolean {
  const taskTypeName = typeMap[task.taskTypeId]?.name ?? "";
  const projectName = projectMap[task.projectId]?.name ?? "";
  const source = `${task.title} ${task.content} ${taskTypeName} ${projectName}`.toLowerCase();
  return LUNCH_TASK_KEYWORDS.some((keyword) => source.includes(keyword));
}

function isLunchProjectTask(task: Task, projectMap: Record<string, Project | undefined>): boolean {
  const projectName = projectMap[task.projectId]?.name.trim().toLowerCase() ?? "";
  return task.projectId === LUNCH_PROJECT_ID || projectName === "점심 약속";
}

function isCalendarTypeTask(
  task: Task,
  typeMap: Record<string, TaskType | undefined>,
  ids: string[],
  names: string[],
): boolean {
  const typeName = typeMap[task.taskTypeId]?.name.trim().toLowerCase() ?? "";
  return ids.includes(task.taskTypeId) || names.includes(typeName);
}

interface CalendarMarkerRule extends Omit<CalendarDayMarker, "count"> {
  matches: (
    task: Task,
    maps: {
      projectMap: Record<string, Project | undefined>;
      typeMap: Record<string, TaskType | undefined>;
    },
  ) => boolean;
}

const CALENDAR_MARKER_RULES: CalendarMarkerRule[] = [
  {
    id: "lunch-project",
    label: "점심",
    detailLabel: "점심 약속",
    tone: "lunch",
    cellClass: "has-marker-lunch",
    priority: 10,
    matches: (task, { projectMap }) => isLunchProjectTask(task, projectMap),
  },
  {
    id: "leave",
    label: "연가",
    tone: "leave",
    cellClass: "has-marker-leave",
    priority: 20,
    matches: (task, { typeMap }) => isCalendarTypeTask(task, typeMap, ["type-leave"], ["연가"]),
  },
  {
    id: "trip",
    label: "출장",
    tone: "trip",
    cellClass: "has-marker-trip",
    priority: 30,
    matches: (task, { typeMap }) => isCalendarTypeTask(task, typeMap, ["type-trip"], ["출장"]),
  },
];

function addCalendarMarker(summary: CalendarDaySummary, rule: CalendarMarkerRule) {
  const existing = summary.markers.find((marker) => marker.id === rule.id);
  if (existing) {
    existing.count += 1;
    return;
  }

  summary.markers.push({
    id: rule.id,
    label: rule.label,
    detailLabel: rule.detailLabel,
    tone: rule.tone,
    cellClass: rule.cellClass,
    priority: rule.priority,
    count: 1,
  });
}

function applyCalendarMarkerRules(
  summary: CalendarDaySummary,
  task: Task,
  maps: {
    projectMap: Record<string, Project | undefined>;
    typeMap: Record<string, TaskType | undefined>;
  },
) {
  for (const rule of CALENDAR_MARKER_RULES) {
    if (rule.matches(task, maps)) {
      addCalendarMarker(summary, rule);
    }
  }
}

function getSchedulePriorityTasks(tasks: Task[], mode: AgendaViewMode): Task[] {
  if (mode === "all") {
    return tasks;
  }

  return tasks.filter(isTaskVisibleOnBoard);
}

function summarizeTasks(tasks: Task[], conflictMap: Record<string, string[]>): CalendarDaySummary {
  return tasks.reduce<CalendarDaySummary>(
    (summary, task) => {
      summary.total += 1;
      summary.done += isTaskDone(task.status) ? 1 : 0;
      summary.canceled += isTaskCanceled(task.status) ? 1 : 0;
      summary.pending += task.status === "NOT_DONE" ? 1 : 0;
      summary.onHold += task.status === "ON_HOLD" ? 1 : 0;
      summary.conflicts += (conflictMap[task.id]?.length ?? 0) > 0 ? 1 : 0;
      summary.major += task.isMajor ? 1 : 0;
      if (isTaskVisibleOnBoard(task)) {
        summary.titles.push(task.title);
      }
      return summary;
    },
    { ...EMPTY_DAY_SUMMARY, markers: [], titles: [] },
  );
}

function getWeekStart(dateKey: string, weekStartsOn: "sun" | "mon"): Date {
  const source = new Date(`${dateKey}T00:00:00`);
  const currentDay = source.getDay();
  const startIndex = weekStartsOn === "mon" ? 1 : 0;
  const diff = (currentDay - startIndex + 7) % 7;
  return addDays(source, -diff);
}

function groupTasksByDate(tasks: Task[]) {
  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    const key = getDateKey(task.startAt);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, items]) => ({
      dateKey,
      title: formatDateLabel(dateKey),
      tasks: items.sort(compareByStartAtAsc),
    }));
}

function compareByStatusGroupThenStartAt(a: Task, b: Task): number {
  const rank = (status: TaskStatus) => {
    if (status === "NOT_DONE") {
      return 0;
    }
    if (status === "ON_HOLD") {
      return 1;
    }
    if (status === "DONE") {
      return 2;
    }
    return 3;
  };
  const rankDiff = rank(a.status) - rank(b.status);
  if (rankDiff !== 0) {
    return rankDiff;
  }
  return compareByStartAtAsc(a, b);
}

interface CompactTaskCardProps {
  task: Task;
  project?: Project;
  taskType?: TaskType;
  timeFormat: "24h" | "12h";
  hasConflict: boolean;
  onClick: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>, task: Task) => void;
}

function CompactTaskCard({
  task,
  project,
  taskType,
  timeFormat,
  hasConflict,
  onClick,
  onStatusChange,
  onContextMenu,
}: CompactTaskCardProps) {
  return (
    <article
      className={`compact-task-card ${task.status.toLowerCase()} ${hasConflict ? "has-conflict" : ""}`}
      style={{ "--task-project-color": project?.color ?? "var(--body-muted)" } as CSSProperties}
      draggable
      onContextMenu={(event) => {
        onContextMenu?.(event, task);
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-task-id", task.id);
        event.dataTransfer.setData("text/plain", task.id);
      }}
    >
      <button type="button" className="compact-task-main" onClick={onClick}>
        <span className="compact-task-time">{formatTaskTime(task, timeFormat)}</span>
        <span className="compact-task-title">{task.title}</span>
        <span className={`status-badge ${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span>
      </button>

      <div className="compact-task-footer">
        <span className="compact-task-meta">
          <span className="compact-project" style={{ color: project?.color ?? "#475569" }}>
            {project?.name ?? "프로젝트 없음"}
          </span>
          <span className="compact-type">{taskType?.name ?? "종류 없음"}</span>
          {task.isMajor ? <span className="compact-major">중요</span> : null}
          {hasConflict ? <span className="compact-conflict">충돌</span> : null}
        </span>

        <div className="compact-status-row" aria-label={`${task.title} 상태 변경`}>
          {(["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"] as TaskStatus[]).map((status) => (
            <button
              key={status}
              type="button"
              className={`compact-status-button ${status.toLowerCase()} ${task.status === status ? "active" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onStatusChange(status);
              }}
              aria-pressed={task.status === status}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

export function DashboardPage() {
  const { tasks, projects, taskTypes, memos, notes, setting, createTask, updateTask, removeTask, saveMemo } = useAppData();
  const navigate = useNavigate();
  const [memoSaved, setMemoSaved] = useState("");
  const [memoError, setMemoError] = useState("");
  const [taskModalState, setTaskModalState] = useState<TaskModalState>(null);
  const [taskFormSerial, setTaskFormSerial] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => getDateKey(new Date()));
  const [datePopoverKey, setDatePopoverKey] = useState<string | null>(null);
  const [calendarViewMode, setCalendarViewMode] = useState<TaskViewMode>("MONTH");
  const [isTopbarExpanded, setIsTopbarExpanded] = useState(false);
  const [scheduleViewMode, setScheduleViewMode] = useState<AgendaViewMode>("priority");
  const [contextMenu, setContextMenu] = useState<DashboardContextMenu | null>(null);

  const today = useMemo(() => new Date(), []);
  const todayKey = getDateKey(today);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !isPastCompletedHidden(task, setting.showPastCompleted)),
    [tasks, setting.showPastCompleted],
  );
  const calendarTasks = tasks;

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);
  const generalProjectId = useMemo(
    () => projects.find((project) => project.id === DEFAULT_PROJECT_ID)?.id ?? projects.find((project) => project.name === "일반")?.id ?? projects[0]?.id ?? DEFAULT_PROJECT_ID,
    [projects],
  );
  const leaveTaskTypeId = useMemo(
    () => taskTypes.find((type) => type.id === "type-leave")?.id ?? taskTypes.find((type) => type.name === "연가")?.id ?? taskTypes[0]?.id ?? "type-leave",
    [taskTypes],
  );
  const memoMap = useMemo(() => Object.fromEntries(memos.map((memo) => [memo.date, memo])), [memos]);
  const conflictMap = useMemo(() => buildTaskConflictMap(visibleTasks), [visibleTasks]);
  const calendarConflictMap = useMemo(() => buildTaskConflictMap(calendarTasks), [calendarTasks]);

  const todayTasks = useMemo(
    () => tasks.filter((task) => getDateKey(task.startAt) === todayKey && isTaskVisibleOnBoard(task)).sort(compareByStatusThenStartAt),
    [tasks, todayKey],
  );

  const submissionTasks = useMemo(
    () =>
      tasks
        .filter((task) => isSubmissionTaskType(task, typeMap))
        .filter(isTaskVisibleOnBoard)
        .sort(compareByStatusThenStartAt),
    [tasks, typeMap],
  );

  const calendarListGroups = useMemo(() => groupTasksByDate(calendarTasks), [calendarTasks]);
  const upcomingCalendarListGroups = useMemo(
    () => calendarListGroups.filter((group) => group.dateKey >= todayKey),
    [calendarListGroups, todayKey],
  );
  const weekStart = useMemo(() => getWeekStart(selectedDate, setting.weekStartsOn), [selectedDate, setting.weekStartsOn]);
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(weekStart, index);
        const key = getDateKey(date);
        return {
          date,
          key,
          tasks: calendarTasks.filter((task) => getDateKey(task.startAt) === key).sort(compareByStartAtAsc),
        };
      }),
    [calendarTasks, weekStart],
  );
  const weekVisibleTaskCount = useMemo(
    () => weekDays.reduce((sum, day) => sum + getSchedulePriorityTasks(day.tasks, scheduleViewMode).length, 0),
    [scheduleViewMode, weekDays],
  );
  const listVisibleTaskCount = useMemo(
    () => upcomingCalendarListGroups.reduce((sum, group) => sum + getSchedulePriorityTasks(group.tasks, scheduleViewMode).length, 0),
    [scheduleViewMode, upcomingCalendarListGroups],
  );
  const visibleCalendarListGroups = useMemo(
    () =>
      upcomingCalendarListGroups.filter((group) => {
        if (scheduleViewMode === "all") {
          return true;
        }
        return getSchedulePriorityTasks(group.tasks, scheduleViewMode).length > 0;
      }),
    [scheduleViewMode, upcomingCalendarListGroups],
  );
  const listViewSourceTasks = useMemo(
    () => upcomingCalendarListGroups.flatMap((group) => group.tasks),
    [upcomingCalendarListGroups],
  );

  const daySummaryByDate = useMemo(() => {
    return calendarTasks.reduce<Record<string, CalendarDaySummary>>((summaryMap, task) => {
      const key = getDateKey(task.startAt);
      const current = summaryMap[key] ?? { ...EMPTY_DAY_SUMMARY, markers: [], titles: [] };
      current.total += 1;
      current.done += isTaskDone(task.status) ? 1 : 0;
      current.canceled += isTaskCanceled(task.status) ? 1 : 0;
      current.pending += task.status === "NOT_DONE" ? 1 : 0;
      current.onHold += task.status === "ON_HOLD" ? 1 : 0;
      current.conflicts += (calendarConflictMap[task.id]?.length ?? 0) > 0 ? 1 : 0;
      const isCanceled = isTaskCanceled(task.status);
      current.major += task.isMajor && !isCanceled ? 1 : 0;
      current.lunch += !isCanceled && isLunchTask(task, typeMap, projectMap) ? 1 : 0;
      if (!isCanceled) {
        applyCalendarMarkerRules(current, task, { projectMap, typeMap });
      }
      // 월간 셀에는 미완료만 보이는 게 기본. "지난 완료 업무를 기본으로 표시"가 켜지면 완료도 보여준다
      if (isTaskVisibleOnBoard(task) || (setting.showPastCompleted && isTaskDone(task.status))) {
        current.titles.push(task.title);
      }
      summaryMap[key] = current;
      return summaryMap;
    }, {});
  }, [calendarConflictMap, calendarTasks, projectMap, typeMap, setting.showPastCompleted]);

  const weekViewSourceTasks = useMemo(() => weekDays.flatMap((day) => day.tasks), [weekDays]);
  const weekViewSummary = useMemo(() => summarizeTasks(weekViewSourceTasks, calendarConflictMap), [calendarConflictMap, weekViewSourceTasks]);
  const listViewSummary = useMemo(() => summarizeTasks(listViewSourceTasks, calendarConflictMap), [calendarConflictMap, listViewSourceTasks]);

  // 월간 보기에서 일정 보드 아래(메모 위)에 보여줄 선택일 일정 — 상태 뱃지로 필터링 가능
  const [selectedDayFilter, setSelectedDayFilter] = useState<"all" | TaskStatus>("all");

  useEffect(() => {
    setSelectedDayFilter("all");
  }, [selectedDate]);

  const selectedDayTasks = useMemo(
    () =>
      calendarTasks
        .filter((task) => getDateKey(task.startAt) === selectedDate)
        .sort(compareByStatusThenStartAt),
    [calendarTasks, selectedDate],
  );
  const selectedDaySummary = useMemo(
    () => summarizeTasks(selectedDayTasks, calendarConflictMap),
    [calendarConflictMap, selectedDayTasks],
  );
  const selectedDayFilteredTasks = useMemo(
    () => (selectedDayFilter === "all" ? selectedDayTasks : selectedDayTasks.filter((task) => task.status === selectedDayFilter)),
    [selectedDayFilter, selectedDayTasks],
  );

  function toggleSelectedDayFilter(status: TaskStatus) {
    setSelectedDayFilter((prev) => (prev === status ? "all" : status));
  }

  const editingTask = useMemo(() => {
    if (!taskModalState || taskModalState.mode !== "edit") {
      return undefined;
    }
    return tasks.find((task) => task.id === taskModalState.taskId);
  }, [taskModalState, tasks]);
  const contextTask = useMemo(() => {
    if (!contextMenu || contextMenu.kind !== "task") {
      return undefined;
    }
    return tasks.find((task) => task.id === contextMenu.taskId);
  }, [contextMenu, tasks]);

  const activeTaskModalState: TaskModalState = taskModalState?.mode === "edit" && !editingTask ? null : taskModalState;
  const globalMemoSource = memoMap[GLOBAL_MEMO_KEY]?.content ?? "";

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

  // 노트 탭에서 "일정 열기"로 넘어오면 해당 일정 수정창을 연다.
  useEffect(() => {
    const handleFocusTask = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string }>).detail;
      if (detail?.taskId) {
        setTaskModalState({ mode: "edit", taskId: detail.taskId });
      }
    };
    window.addEventListener("ai-planner:focus-task", handleFocusTask);
    return () => window.removeEventListener("ai-planner:focus-task", handleFocusTask);
  }, []);

  useEffect(() => {
    if (!datePopoverKey) {
      return;
    }
    if ((daySummaryByDate[datePopoverKey]?.total ?? 0) === 0) {
      const timerId = window.setTimeout(() => {
        setDatePopoverKey(null);
      }, 0);
      return () => {
        window.clearTimeout(timerId);
      };
    }
  }, [datePopoverKey, daySummaryByDate]);

  useEffect(() => {
    if (!datePopoverKey) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".calendar-day-popover")) {
        return;
      }
      if (target?.closest(".modal-backdrop, .modal-card")) {
        return;
      }
      setDatePopoverKey(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDatePopoverKey(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [datePopoverKey]);

  async function handleCreateTask(input: TaskFormInput) {
    await createTask(input);
    setTaskModalState(null);
    setTaskFormSerial((prev) => prev + 1);
  }

  async function handleUpdateTask(input: TaskFormInput) {
    if (!editingTask) {
      return;
    }
    await updateTask(editingTask.id, input);
  }

  async function handleDeleteTask() {
    if (!editingTask) {
      return;
    }
    await removeTask(editingTask.id);
    setTaskModalState(null);
  }

  async function handleSaveGlobalMemo(content: string) {
    setMemoError("");
    try {
      await saveMemo(GLOBAL_MEMO_KEY, content);
      setMemoSaved("저장 완료");
    } catch (saveError) {
      setMemoError(saveError instanceof Error ? saveError.message : "메모 저장에 실패했습니다.");
      throw saveError;
    }
  }

  async function handleDropTaskToDate(taskId: string, dateKey: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }

    await updateTask(task.id, {
      ...toTaskInput(task),
      startAt: shiftIsoToDateKey(task.startAt, dateKey),
      endAt: task.endAt ? shiftIsoToDateKey(task.endAt, dateKey) : undefined,
    });
  }

  function getLeaveTasksForDate(dateKey: string) {
    return tasks.filter(
      (task) =>
        getDateKey(task.startAt) === dateKey &&
        isTaskActive(task.status) &&
        isCalendarTypeTask(task, typeMap, ["type-leave"], ["연가"]),
    );
  }

  function handleCalendarDateSelect(dateKey: string) {
    setSelectedDate(dateKey);
    setContextMenu(null);
    setDatePopoverKey((daySummaryByDate[dateKey]?.total ?? 0) > 0 ? dateKey : null);
  }

  function openCreateTask(defaultDate = selectedDate) {
    setDatePopoverKey(null);
    setTaskFormSerial((prev) => prev + 1);
    setTaskModalState({ mode: "create", defaultDate });
  }

  function openEditTask(taskId: string) {
    setTaskModalState({ mode: "edit", taskId });
  }

  function changeTaskStatus(task: Task, status: TaskStatus) {
    void updateTask(task.id, {
      ...toTaskInput(task),
      status,
    });
  }

  function openAiSchedule(initialDraft: string) {
    window.dispatchEvent(
      new CustomEvent("ai-planner:open-ai-schedule", {
        detail: { initialDraft },
      }),
    );
  }

  function openDateContextMenu(event: MouseEvent<HTMLElement>, dateKey: string) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedDate(dateKey);
    setDatePopoverKey(null);
    setContextMenu({
      kind: "date",
      x: event.clientX,
      y: event.clientY,
      dateKey,
    });
  }

  function openTaskContextMenu(event: MouseEvent<HTMLElement>, task: Task) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "task",
      x: event.clientX,
      y: event.clientY,
      taskId: task.id,
    });
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

  async function toggleLeaveForDate(dateKey: string) {
    const existingLeaveTasks = getLeaveTasksForDate(dateKey);
    setDatePopoverKey(null);

    if (existingLeaveTasks.length > 0) {
      await Promise.all(existingLeaveTasks.map((task) => removeTask(task.id)));
      return;
    }

    await createTask({
      title: "연가",
      content: "",
      taskTypeId: leaveTaskTypeId,
      projectId: generalProjectId,
      status: "NOT_DONE",
      startAt: combineDateTimeToIso(dateKey, "09:00"),
      endAt: combineDateTimeToIso(dateKey, "18:00"),
      isMajor: false,
    });
  }

  function getContextMenuTitle(): string | undefined {
    if (!contextMenu) {
      return undefined;
    }
    if (contextMenu.kind === "date") {
      return formatContextDateLabel(contextMenu.dateKey);
    }
    return contextTask?.title;
  }

  function getContextMenuItems(): ContextMenuItem[] {
    if (!contextMenu) {
      return [];
    }

    if (contextMenu.kind === "date") {
      const dateLabel = formatContextDateLabel(contextMenu.dateKey);
      const hasLeave = getLeaveTasksForDate(contextMenu.dateKey).length > 0;
      return [
        {
          id: "ai-create-date-task",
          label: "AI 일정 추가",
          description: "이 날짜를 기준으로 초안 만들기",
          tone: "primary",
          onSelect: () => openAiSchedule(`${dateLabel} 일정으로 `),
        },
        {
          id: "create-date-task",
          label: "일정 직접 추가",
          description: "선택한 날짜로 입력 폼 열기",
          onSelect: () => openCreateTask(contextMenu.dateKey),
        },
        {
          id: "toggle-date-leave",
          label: hasLeave ? "연가 취소" : "연가 설정",
          description: hasLeave ? "이 날짜의 연가 일정을 제거" : "09:00-18:00 연가 일정 생성",
          tone: hasLeave ? "danger" : "default",
          onSelect: () => {
            void toggleLeaveForDate(contextMenu.dateKey);
          },
        },
      ];
    }

    if (!contextTask) {
      return [];
    }

    const dateLabel = formatContextDateLabel(getDateKey(contextTask.startAt));
    const timeLabel = formatTaskTime(contextTask, setting.timeFormat);

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
            `다음 기존 일정을 수정해줘.\n- 날짜: ${dateLabel}\n- 시간: ${timeLabel}\n- 제목: ${contextTask.title}\n- 상태: ${STATUS_LABELS[contextTask.status]}\n\n수정 요청: `,
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

  function toggleTaskCompletion(task: Task, checked: boolean) {
    changeTaskStatus(task, checked ? "DONE" : "NOT_DONE");
  }

  function renderCompactTasks(items: Task[], emptyText: string) {
    if (items.length === 0) {
      return <p className="empty-text">{emptyText}</p>;
    }

    return (
      <div className="compact-task-list">
        {items.map((task) => (
          <CompactTaskCard
            key={task.id}
            task={task}
            project={projectMap[task.projectId]}
            taskType={typeMap[task.taskTypeId]}
            timeFormat={setting.timeFormat}
            hasConflict={(conflictMap[task.id]?.length ?? 0) > 0}
            onClick={() => openEditTask(task.id)}
            onStatusChange={(status) => changeTaskStatus(task, status)}
            onContextMenu={openTaskContextMenu}
          />
        ))}
      </div>
    );
  }

  function renderMarkdownChecklist(
    items: Task[],
    options: {
      title: string;
      formatLabel: (task: Task) => string;
      emptyText: string;
    },
  ) {
    return (
      <section className="dashboard-markdown-block" aria-label={options.title}>
        <h3>{options.title}</h3>
        {items.length === 0 ? (
          <p className="dashboard-markdown-empty">{options.emptyText}</p>
        ) : (
          <ul className="dashboard-markdown-list">
            {items.map((task) => (
              <li key={`${options.title}-${task.id}`} className={`dashboard-markdown-item ${task.status === "DONE" ? "done" : ""}`}>
                <div className="dashboard-markdown-row">
                  <input
                    type="checkbox"
                    checked={task.status === "DONE"}
                    onChange={(event) => toggleTaskCompletion(task, event.target.checked)}
                    aria-label={`${task.title} 완료 여부`}
                  />
                  <button
                    type="button"
                    className={`dashboard-markdown-line ${task.isMajor ? "major" : ""}`}
                    onClick={() => openEditTask(task.id)}
                  >
                    {options.formatLabel(task)}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  function renderCalendarTaskCards(items: Task[], emptyText: string) {
    if (items.length === 0) {
      return <p className="empty-text">{emptyText}</p>;
    }

    return (
      <div className="compact-task-list">
        {items.map((task) => (
          <CompactTaskCard
            key={task.id}
            task={task}
            project={projectMap[task.projectId]}
            taskType={typeMap[task.taskTypeId]}
            timeFormat={setting.timeFormat}
            hasConflict={(calendarConflictMap[task.id]?.length ?? 0) > 0}
            onClick={() => openEditTask(task.id)}
            onStatusChange={(status) => changeTaskStatus(task, status)}
            onContextMenu={openTaskContextMenu}
          />
        ))}
      </div>
    );
  }

  function renderScheduleStatGrid(summary: CalendarDaySummary) {
    return (
      <div className="agenda-stat-grid">
        <button
          type="button"
          className={`all ${scheduleViewMode === "all" ? "active" : ""}`}
          onClick={() => setScheduleViewMode((prev) => (prev === "all" ? "priority" : "all"))}
          aria-pressed={scheduleViewMode === "all"}
        >
          전체 {summary.total}
        </button>
        <span className="not_done">미완료 {summary.pending}</span>
        <span className="on_hold">보류 {summary.onHold}</span>
        <span className="done">완료 {summary.done}</span>
        <span className="canceled">취소 {summary.canceled}</span>
        <span className="conflict">충돌 {summary.conflicts}</span>
      </div>
    );
  }

  function renderSelectedDatePopover(dateKey: string) {
    const dayTasks = calendarTasks
      .filter((task) => getDateKey(task.startAt) === dateKey)
      .sort(compareByStatusGroupThenStartAt);

    if (dayTasks.length === 0) {
      return null;
    }

    const isAllDoneDay = dayTasks.every((task) => task.status === "DONE");

    return (
      <section className="calendar-day-detail-popover" aria-label={`${formatDateLabel(dateKey)} 일정`}>
        <header>
          <div>
            <span>선택일</span>
            <strong>{formatDateLabel(dateKey)}</strong>
          </div>
          <button type="button" className="btn btn-soft" onClick={() => openCreateTask(dateKey)}>
            일정 추가
          </button>
        </header>

        {dayTasks.length > 0 ? (
          <div className="calendar-day-detail-list">
            {dayTasks.map((task) => {
              const project = projectMap[task.projectId];
              const taskType = typeMap[task.taskTypeId];
              const hasConflict = (calendarConflictMap[task.id]?.length ?? 0) > 0;
              const isProjectTinted = task.status === "NOT_DONE" || (task.status === "DONE" && isAllDoneDay);

              return (
                <button
                  key={task.id}
                  type="button"
                  className={`calendar-day-detail-item ${task.status.toLowerCase()} ${isProjectTinted ? "project-tinted" : ""} ${
                    isAllDoneDay ? "all-done-day" : ""
                  } ${hasConflict ? "conflict" : ""}`}
                  style={isProjectTinted ? getCalendarDetailProjectStyle(project) : undefined}
                  onClick={() => openEditTask(task.id)}
                  onContextMenu={(event) => openTaskContextMenu(event, task)}
                >
                  <span className="calendar-day-detail-main">
                    <span className="calendar-day-detail-copy">
                      <span className="calendar-day-detail-headline">
                        <span className="calendar-day-detail-time">{formatTaskTime(task, setting.timeFormat)}</span>
                        <strong>{task.title}</strong>
                      </span>
                      <small>
                        {project?.name ?? "프로젝트 없음"} · {taskType?.name ?? "종류 없음"}
                      </small>
                    </span>
                    <span className="calendar-day-detail-badges">
                      <span className={`status-badge ${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span>
                      {hasConflict ? <span className="conflict-badge">충돌</span> : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div className="dashboard-workspace">
      <section className={`dashboard-topbar compact-dashboard-topbar ${isTopbarExpanded ? "expanded" : "collapsed"}`}>
        <button
          type="button"
          className="dashboard-summary-trigger"
          onClick={() => setIsTopbarExpanded((prev) => !prev)}
          aria-expanded={isTopbarExpanded}
          aria-controls="dashboard-summary-panel"
          aria-label={isTopbarExpanded ? "일정 요약 접기" : "일정 요약 펼치기"}
          title={isTopbarExpanded ? "일정 요약 접기" : "일정 요약 펼치기"}
        >
          <p className="eyebrow">TODAY</p>
          <h2>{formatFullDate(today)}</h2>
        </button>
        <div className="dashboard-hero-actions">
          <DailyBriefing />
          <TaskViewSegmentedControl value={calendarViewMode} onChange={setCalendarViewMode} ariaLabel="대시보드 일정 보기 방식" />
          {/* 제목 버튼과 같은 패널을 여닫는 보조 버튼 — 보조기술에는 중복이라 숨긴다 */}
          <button
            type="button"
            className={`btn btn-soft dashboard-summary-toggle ${isTopbarExpanded ? "expanded" : ""}`}
            onClick={() => setIsTopbarExpanded((prev) => !prev)}
            aria-hidden="true"
            tabIndex={-1}
            title={isTopbarExpanded ? "일정 요약 접기" : "일정 요약 펼치기"}
          >
            {isTopbarExpanded ? "요약 접기" : "요약 펼치기"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openCreateTask(todayKey)}>
            일정 추가
          </button>
        </div>
        <div
          id="dashboard-summary-panel"
          className={`dashboard-summary-row dashboard-markdown-summary ${isTopbarExpanded ? "expanded" : "collapsed"}`}
          hidden={!isTopbarExpanded}
        >
          {renderMarkdownChecklist(todayTasks, {
            title: "오늘 일정",
            formatLabel: (task) => `${formatTimeOnly(task.startAt, setting.timeFormat)} ${task.title}`,
            emptyText: "오늘 일정이 없습니다.",
          })}
          <div className="dashboard-markdown-divider" aria-hidden="true" />
          {renderMarkdownChecklist(submissionTasks, {
            title: "제출 일정",
            formatLabel: (task) => `${formatShortDateTime(task.startAt)} ${task.title}`,
            emptyText: "제출 일정이 없습니다.",
          })}
        </div>
      </section>

      <div className="dashboard-primary-grid">
        <section className="dashboard-card dashboard-calendar-card premium-calendar-card">
          <header className="dashboard-card-header">
            <div>
              <p className="eyebrow">CALENDAR</p>
              <h3>일정 보드</h3>
            </div>
          </header>

          {calendarViewMode === "MONTH" ? (
            <div className="dashboard-calendar-month">
              <MonthCalendar
                selectedDate={selectedDate}
                weekStartsOn={setting.weekStartsOn}
                daySummaryByDate={daySummaryByDate}
                onSelectDate={handleCalendarDateSelect}
                onDropTaskToDate={handleDropTaskToDate}
                onCreateTaskAtDate={openCreateTask}
                onDayContextMenu={openDateContextMenu}
                renderSelectedDateDetails={datePopoverKey === selectedDate ? renderSelectedDatePopover : undefined}
              />
            </div>
          ) : null}

          {calendarViewMode === "WEEK" ? (
            <section className="dashboard-schedule-view dashboard-week-view" aria-label="주간 일정">
              <header className="schedule-view-header">
                <div>
                  <p className="eyebrow">WEEK</p>
                  <h3>{formatDateLabel(getDateKey(weekStart))} 시작 주간</h3>
                </div>
                <span>{weekVisibleTaskCount}/{weekViewSourceTasks.length}개</span>
              </header>
              {renderScheduleStatGrid(weekViewSummary)}
              <div className="week-agenda">
                {weekDays.map((day) => {
                  const visibleDayTasks = getSchedulePriorityTasks(day.tasks, scheduleViewMode);
                  const isToday = day.key === todayKey;
                  const isEmpty = visibleDayTasks.length === 0;
                  return (
                    <section key={day.key} className={`week-day-row ${isToday ? "today" : ""} ${isEmpty ? "empty" : ""}`}>
                      <div className="week-day-head">
                        <div className="week-day-date">
                          <span className="week-day-dow">{formatWeekday(day.date)}</span>
                          <strong className="week-day-num">{day.date.getDate()}</strong>
                          {isToday ? <span className="week-day-today-badge">오늘</span> : null}
                        </div>
                        <div className="week-day-meta">
                          <span>{isEmpty ? "일정 없음" : `${visibleDayTasks.length}/${day.tasks.length}개`}</span>
                          <button
                            type="button"
                            className="week-day-add"
                            onClick={() => openCreateTask(day.key)}
                            aria-label={`${formatDayLabel(day.date)} 일정 추가`}
                          >
                            + 추가
                          </button>
                        </div>
                      </div>
                      <div className="week-day-body">
                        {isEmpty ? (
                          <button type="button" className="week-day-empty" onClick={() => openCreateTask(day.key)}>
                            + 일정 추가
                          </button>
                        ) : (
                          renderCalendarTaskCards(visibleDayTasks, "")
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </section>
          ) : null}

          {calendarViewMode === "LIST" ? (
            <section className="dashboard-schedule-view dashboard-list-view" aria-label="목록형 일정">
              <header className="schedule-view-header">
                <div>
                  <p className="eyebrow">LIST</p>
                  <h3>전체 일정 목록</h3>
                </div>
                <span>{listVisibleTaskCount}/{listViewSourceTasks.length}개</span>
              </header>
              {renderScheduleStatGrid(listViewSummary)}
              {visibleCalendarListGroups.length === 0 ? (
                <div className="empty-state compact">
                  <p>등록된 일정이 없습니다.</p>
                </div>
              ) : null}
              {visibleCalendarListGroups.map((group) => {
                const visibleGroupTasks = getSchedulePriorityTasks(group.tasks, scheduleViewMode);
                return (
                  <section key={group.dateKey} className="task-date-group dashboard-list-date-group">
                    <header>
                      <h3>{group.title}</h3>
                      <span>{visibleGroupTasks.length}/{group.tasks.length}개</span>
                    </header>
                    {renderCalendarTaskCards(visibleGroupTasks, "일정이 없습니다.")}
                  </section>
                );
              })}
            </section>
          ) : null}
        </section>

        <aside className="dashboard-side-column">
          <section className="dashboard-card today-task-card">
            <header className="dashboard-card-header">
              <div>
                <p className="eyebrow">TODAY</p>
                <h3>오늘 할 일</h3>
              </div>
              <span>{todayTasks.length}개</span>
            </header>
            {renderCompactTasks(todayTasks, "오늘 등록된 일정이 없습니다.")}
          </section>
        </aside>
      </div>

      {calendarViewMode === "MONTH" ? (
        <section className="dashboard-card dashboard-selected-day-card" aria-label="선택한 날짜의 일정">
          <header className="dashboard-card-header">
            <div>
              <p className="eyebrow">SELECTED DAY</p>
              <h3>{formatDateLabel(selectedDate)} 일정</h3>
            </div>
            <button type="button" className="btn btn-soft btn-compact" onClick={() => openCreateTask(selectedDate)}>
              일정 추가
            </button>
          </header>

          <div className="agenda-stat-grid selected-day-filter" role="group" aria-label="상태별 필터">
            <button
              type="button"
              className={`all ${selectedDayFilter === "all" ? "active" : ""}`}
              onClick={() => setSelectedDayFilter("all")}
              aria-pressed={selectedDayFilter === "all"}
            >
              전체 {selectedDaySummary.total}
            </button>
            <button
              type="button"
              className={`not_done ${selectedDayFilter === "NOT_DONE" ? "active" : ""}`}
              onClick={() => toggleSelectedDayFilter("NOT_DONE")}
              aria-pressed={selectedDayFilter === "NOT_DONE"}
            >
              미완료 {selectedDaySummary.pending}
            </button>
            <button
              type="button"
              className={`on_hold ${selectedDayFilter === "ON_HOLD" ? "active" : ""}`}
              onClick={() => toggleSelectedDayFilter("ON_HOLD")}
              aria-pressed={selectedDayFilter === "ON_HOLD"}
            >
              보류 {selectedDaySummary.onHold}
            </button>
            <button
              type="button"
              className={`done ${selectedDayFilter === "DONE" ? "active" : ""}`}
              onClick={() => toggleSelectedDayFilter("DONE")}
              aria-pressed={selectedDayFilter === "DONE"}
            >
              완료 {selectedDaySummary.done}
            </button>
            <button
              type="button"
              className={`canceled ${selectedDayFilter === "CANCELED" ? "active" : ""}`}
              onClick={() => toggleSelectedDayFilter("CANCELED")}
              aria-pressed={selectedDayFilter === "CANCELED"}
            >
              취소 {selectedDaySummary.canceled}
            </button>
          </div>

          {renderCalendarTaskCards(
            selectedDayFilteredTasks,
            selectedDayFilter === "all" ? "이 날짜에 일정이 없습니다." : "해당 상태의 일정이 없습니다.",
          )}
        </section>
      ) : null}

      <section className="dashboard-memo-section">
        <MarkdownMemo
          content={globalMemoSource}
          savedMessage={memoSaved}
          errorMessage={memoError}
          onEditStart={() => {
            setMemoSaved("");
            setMemoError("");
          }}
          onSave={handleSaveGlobalMemo}
        />
      </section>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={getContextMenuTitle()}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

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
            aria-label="일정 상세 또는 수정"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>{activeTaskModalState.mode === "create" ? "일정 추가" : "일정 수정"}</h2>
              <button type="button" className="btn btn-soft" onClick={() => setTaskModalState(null)}>
                닫기
              </button>
            </header>

            {activeTaskModalState.mode === "create" ? (
              <TaskForm
                key={`dashboard-new-task-${activeTaskModalState.defaultDate ?? selectedDate}-${taskFormSerial}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                defaultStartDate={activeTaskModalState.defaultDate ?? selectedDate}
                timeFormat={setting.timeFormat}
                onSubmit={handleCreateTask}
              />
            ) : editingTask ? (
              <TaskForm
                key={`dashboard-edit-task-${editingTask.id}`}
                projects={projects}
                taskTypes={taskTypes}
                allTasks={tasks}
                initialTask={editingTask}
                timeFormat={setting.timeFormat}
                linkedNotes={notes
                  .filter((note) => (editingTask.linkedNoteIds ?? []).includes(note.id))
                  .map((note) => ({ id: note.id, title: note.title }))}
                onOpenNote={(noteId) => {
                  setTaskModalState(null);
                  navigate("/notes");
                  window.setTimeout(() => {
                    window.dispatchEvent(new CustomEvent("ai-planner:focus-note", { detail: { noteId } }));
                  }, 80);
                }}
                onSubmit={handleUpdateTask}
                onDelete={handleDeleteTask}
                onCancel={() => setTaskModalState(null)}
              />
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
