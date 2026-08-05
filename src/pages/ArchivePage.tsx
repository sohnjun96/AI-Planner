import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "../routing";
import { analyzeLunchMateAliases, type LunchMateGroup } from "../agent/lunchMateAgent";
import {
  clampLlmTemperature,
  normalizeLlmGemmaThinkingEnabled,
  normalizeLlmReasoningEffort,
  STATUS_LABELS,
} from "../constants";
import { useAppData } from "../context/AppDataContext";
import { db } from "../db";
import type { Project, Task, TaskType } from "../models";
import {
  applyLunchMateAliasGroups,
  createLunchMateFingerprint,
  extractLunchMateCandidates,
  findPeakDay,
  isInArchivePeriod,
  isLunchArchiveTask,
  isWorkArchiveTask,
  type ArchivePeriod,
} from "../utils/archiveInsights";
import { formatDateTime, getDateKey } from "../utils/date";

interface ArchiveFilters {
  keyword: string;
  projectId: string;
  taskTypeId: string;
  fromDate: string;
  toDate: string;
  majorOnly: boolean;
}

interface ArchiveActivityDay {
  key: string;
  date: Date;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  isOutsideRange: boolean;
}

interface ArchiveActivityWeek {
  key: string;
  monthLabel: string;
  days: ArchiveActivityDay[];
}

type ActivityMode = "completed" | "created";

const ACTIVITY_WEEK_COUNT = 53;
const ACTIVITY_DAY_COUNT = 365;
const RECENT_COMPLETED_LIMIT = 10;
const LUNCH_ANALYSIS_STABILIZATION_MS = 300;
const PERIOD_OPTIONS: Array<{ value: ArchivePeriod; label: string }> = [
  { value: "month", label: "이번 달" },
  { value: "year", label: "올해" },
  { value: "rolling", label: "최근 1년" },
  { value: "all", label: "전체" },
];

function addCalendarDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function getActivityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

function formatActivityMonth(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "short" }).format(value);
}

function formatActivityDay(value: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(value);
}

function formatRecordDay(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function buildArchiveActivity(
  tasks: Task[],
  currentTime: number,
  weekStartsOn: "sun" | "mon",
  dateSelector: (task: Task) => string,
) {
  const today = new Date(currentTime);
  today.setHours(0, 0, 0, 0);
  const rangeStart = addCalendarDays(today, -(ACTIVITY_DAY_COUNT - 1));
  const weekStartIndex = weekStartsOn === "mon" ? 1 : 0;
  const daysUntilWeekEnd = (weekStartIndex + 6 - today.getDay() + 7) % 7;
  const chartEnd = addCalendarDays(today, daysUntilWeekEnd);
  const chartStart = addCalendarDays(chartEnd, -(ACTIVITY_WEEK_COUNT * 7 - 1));
  const rangeStartKey = getDateKey(rangeStart);
  const todayKey = getDateKey(today);
  const countByDate = new Map<string, number>();

  tasks.forEach((task) => {
    const key = getDateKey(dateSelector(task));
    if (key < rangeStartKey || key > todayKey) return;
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
  });

  const weeks: ArchiveActivityWeek[] = Array.from({ length: ACTIVITY_WEEK_COUNT }, (_, weekIndex) => {
    const weekStart = addCalendarDays(chartStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addCalendarDays(weekStart, dayIndex);
      const key = getDateKey(date);
      const isOutsideRange = key < rangeStartKey || key > todayKey;
      const count = isOutsideRange ? 0 : (countByDate.get(key) ?? 0);
      return { key, date, count, level: getActivityLevel(count), isOutsideRange } satisfies ArchiveActivityDay;
    });
    const firstDayOfMonth = days.find((day) => !day.isOutsideRange && day.date.getDate() === 1);
    return {
      key: getDateKey(weekStart),
      monthLabel: firstDayOfMonth
        ? formatActivityMonth(firstDayOfMonth.date)
        : weekIndex === 0
          ? formatActivityMonth(rangeStart)
          : "",
      days,
    };
  });

  const daysInRange = weeks.flatMap((week) => week.days).filter((day) => !day.isOutsideRange);
  const total = daysInRange.reduce((sum, day) => sum + day.count, 0);
  const activeDayRecords = daysInRange.filter((day) => day.count > 0);
  const busiestDay = daysInRange.reduce<ArchiveActivityDay | undefined>((busiest, day) => {
    if (!busiest || day.count > busiest.count) return day;
    return busiest;
  }, undefined);
  return {
    weeks,
    total,
    activeDays: activeDayRecords.length,
    activeDayRecords,
    busiestDay: busiestDay && busiestDay.count > 0 ? busiestDay : undefined,
    rangeStartKey,
    todayKey,
  };
}

function formatMonthLabel(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(
    new Date(`${value}-01T00:00:00`),
  );
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(value),
  );
}

function formatElapsedDays(value: string, currentTime: number): string {
  const days = Math.max(0, Math.floor((currentTime - new Date(value).getTime()) / 86_400_000));
  return days === 0 ? "오늘" : `${days}일 전`;
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

function countActiveFilters(filters: ArchiveFilters): number {
  return [filters.keyword.trim(), filters.projectId, filters.taskTypeId, filters.fromDate, filters.toDate, filters.majorOnly].filter(
    Boolean,
  ).length;
}

function parseCachedLunchMateGroups(payload: string | undefined): LunchMateGroup[] | undefined {
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const groups = parsed.filter(
      (item): item is LunchMateGroup =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as LunchMateGroup).displayName === "string" &&
        Array.isArray((item as LunchMateGroup).aliases) &&
        typeof (item as LunchMateGroup).count === "number" &&
        typeof (item as LunchMateGroup).confidence === "number",
    );
    return groups.length > 0 ? groups : undefined;
  } catch {
    return undefined;
  }
}

function dedupeCreatedTasks(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const key = task.recurrenceGroupId ? `recurrence:${task.recurrenceGroupId}` : task.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface ArchiveTaskCardProps {
  task: Task;
  project?: Project;
  taskType?: TaskType;
  currentTime: number;
  timeFormat: "12h" | "24h";
  compact?: boolean;
  onOpen: () => void;
  onReopen: () => void;
}

function ArchiveTaskCard({
  task,
  project,
  taskType,
  currentTime,
  timeFormat,
  compact = false,
  onOpen,
  onReopen,
}: ArchiveTaskCardProps) {
  return (
    <article className={`archive-task-card ${compact ? "compact" : ""}`}>
      <div className="archive-task-main">
        <div className="archive-task-title-row">
          <strong>{task.title}</strong>
          {task.isMajor ? <span className="badge-pill warning">중요</span> : null}
        </div>
        <span>
          {formatDateTime(task.startAt, timeFormat)}
          {task.endAt ? ` - ${formatDateTime(task.endAt, timeFormat)}` : ""}
        </span>
        <div className="archive-tag-row">
          <span style={{ backgroundColor: `${project?.color ?? "#6b7280"}1f`, color: project?.color ?? "#4b5563" }}>
            {project?.name ?? "프로젝트 없음"}
          </span>
          <span style={{ backgroundColor: `${taskType?.color ?? "#6b7280"}1f`, color: taskType?.color ?? "#4b5563" }}>
            {taskType?.name ?? "종류 없음"}
          </span>
          <span className="archive-completed-tag">
            {task.completedAt ? `완료 ${formatDateOnly(task.completedAt)}` : "완료일 없음"}
          </span>
        </div>
        {!compact && task.content ? <p>{task.content}</p> : null}
      </div>
      <div className="archive-task-actions">
        <span className="status-badge done">{STATUS_LABELS.DONE}</span>
        <span className="archive-elapsed-tag">{formatElapsedDays(task.completedAt ?? task.startAt, currentTime)}</span>
        <button type="button" className="btn btn-soft btn-compact" onClick={onOpen}>
          상세 보기
        </button>
        <button type="button" className="btn btn-outline btn-compact" onClick={onReopen}>
          미완료로 되돌리기
        </button>
      </div>
    </article>
  );
}

export function ArchivePage() {
  const { tasks, projects, taskTypes, setting, updateTask } = useAppData();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [period, setPeriod] = useState<ArchivePeriod>("year");
  const [activityMode, setActivityMode] = useState<ActivityMode>("completed");
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isAnalyzingLunch, setIsAnalyzingLunch] = useState(false);
  const [lunchAnalysisError, setLunchAnalysisError] = useState("");
  const lunchAnalysisRequestIdRef = useRef(0);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<ArchiveFilters>({
    keyword: "",
    projectId: "",
    taskTypeId: "",
    fromDate: "",
    toDate: "",
    majorOnly: false,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const projectMap = useMemo<Record<string, Project | undefined>>(
    () => Object.fromEntries(projects.map((project) => [project.id, project])),
    [projects],
  );
  const typeMap = useMemo<Record<string, TaskType | undefined>>(
    () => Object.fromEntries(taskTypes.map((type) => [type.id, type])),
    [taskTypes],
  );

  const allArchivedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status === "DONE" && new Date(task.completedAt ?? task.startAt).getTime() < currentTime)
        .sort(
          (a, b) =>
            new Date(b.completedAt ?? b.startAt).getTime() - new Date(a.completedAt ?? a.startAt).getTime(),
        ),
    [currentTime, tasks],
  );
  const workArchivedTasks = useMemo(
    () => allArchivedTasks.filter((task) => isWorkArchiveTask(task, projectMap, typeMap)),
    [allArchivedTasks, projectMap, typeMap],
  );
  const createdWorkTasks = useMemo(
    () => dedupeCreatedTasks(tasks.filter((task) => isWorkArchiveTask(task, projectMap, typeMap))),
    [projectMap, tasks, typeMap],
  );
  const periodCompletedTasks = useMemo(
    () =>
      workArchivedTasks.filter((task) =>
        isInArchivePeriod(task.completedAt ?? task.startAt, period, currentTime),
      ),
    [currentTime, period, workArchivedTasks],
  );
  const periodCreatedTasks = useMemo(
    () => createdWorkTasks.filter((task) => isInArchivePeriod(task.createdAt, period, currentTime)),
    [createdWorkTasks, currentTime, period],
  );
  const periodLunchTasks = useMemo(
    () =>
      allArchivedTasks.filter(
        (task) =>
          isLunchArchiveTask(task, projectMap, typeMap) &&
          isInArchivePeriod(task.completedAt ?? task.startAt, period, currentTime),
      ),
    [allArchivedTasks, currentTime, period, projectMap, typeMap],
  );

  const allLunchTasks = useMemo(
    () => allArchivedTasks.filter((task) => isLunchArchiveTask(task, projectMap, typeMap)),
    [allArchivedTasks, projectMap, typeMap],
  );
  const allLunchCandidates = useMemo(
    () => extractLunchMateCandidates(allLunchTasks, projectMap, typeMap),
    [allLunchTasks, projectMap, typeMap],
  );
  const periodLunchCandidates = useMemo(
    () => extractLunchMateCandidates(periodLunchTasks, projectMap, typeMap),
    [periodLunchTasks, projectMap, typeMap],
  );
  const lunchFingerprint = useMemo(() => createLunchMateFingerprint(allLunchCandidates), [allLunchCandidates]);
  const lunchCacheId = "lunch-mate:aliases";
  const lunchCache = useLiveQuery(() => db.archiveInsightCaches.get(lunchCacheId), [], null);
  const isLunchCacheReady = lunchCache !== null;
  const allLunchCandidatesRef = useRef(allLunchCandidates);
  const lunchCacheRef = useRef(lunchCache);
  const lunchGenerationOptions = useMemo(
    () => ({
      temperature: clampLlmTemperature(setting.llmTemperature),
      reasoningEffort: normalizeLlmReasoningEffort(setting.llmReasoningEffort),
      gemmaThinkingEnabled: normalizeLlmGemmaThinkingEnabled(setting.llmGemmaThinkingEnabled),
    }),
    [setting.llmGemmaThinkingEnabled, setting.llmReasoningEffort, setting.llmTemperature],
  );
  const lunchAnalysisDateKey = getDateKey(new Date(currentTime));
  const lunchLastAttemptedDateKey = lunchCache?.lastAttemptedAt
    ? getDateKey(lunchCache.lastAttemptedAt)
    : "";

  useEffect(() => {
    allLunchCandidatesRef.current = allLunchCandidates;
    lunchCacheRef.current = lunchCache;
  }, [allLunchCandidates, lunchCache]);

  const cachedLunchGroups = useMemo(
    () => parseCachedLunchMateGroups(lunchCache?.payload),
    [lunchCache?.payload],
  );
  const lunchGroups = useMemo(
    () => applyLunchMateAliasGroups(periodLunchCandidates, cachedLunchGroups),
    [cachedLunchGroups, periodLunchCandidates],
  );
  const topLunchMate = lunchGroups[0];
  const hasAiLunchAnalysis = Boolean(cachedLunchGroups);

  const bestCompletionDay = useMemo(
    () => findPeakDay(periodCompletedTasks, (task) => task.completedAt ?? task.startAt),
    [periodCompletedTasks],
  );
  const bestCreatedDay = useMemo(
    () => findPeakDay(periodCreatedTasks, (task) => task.createdAt),
    [periodCreatedTasks],
  );
  const topProjectRecord = useMemo(() => {
    const counts = new Map<string, number>();
    periodCompletedTasks.forEach((task) => counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? { project: projectMap[top[0]], count: top[1] } : undefined;
  }, [periodCompletedTasks, projectMap]);

  const activitySource = activityMode === "completed" ? workArchivedTasks : createdWorkTasks;
  const yearlyActivity = useMemo(
    () =>
      buildArchiveActivity(
        activitySource,
        currentTime,
        setting.weekStartsOn,
        activityMode === "completed" ? (task) => task.completedAt ?? task.startAt : (task) => task.createdAt,
      ),
    [activityMode, activitySource, currentTime, setting.weekStartsOn],
  );
  const activityLabel = activityMode === "completed" ? "완료" : "추가";
  const activityWeekdayLabels =
    setting.weekStartsOn === "mon" ? ["월", "", "수", "", "금", "", ""] : ["", "월", "", "수", "", "금", ""];
  const recentCompletedTasks = allArchivedTasks.slice(0, RECENT_COMPLETED_LIMIT);

  const archivedTasks = useMemo(
    () =>
      allArchivedTasks.filter((task) => {
        if (filters.keyword.trim()) {
          const term = filters.keyword.trim().toLowerCase();
          const projectName = projectMap[task.projectId]?.name ?? "";
          const typeName = typeMap[task.taskTypeId]?.name ?? "";
          if (!`${task.title} ${task.content} ${projectName} ${typeName}`.toLowerCase().includes(term)) return false;
        }
        if (filters.projectId && task.projectId !== filters.projectId) return false;
        if (filters.taskTypeId && task.taskTypeId !== filters.taskTypeId) return false;
        if (filters.majorOnly && !task.isMajor) return false;
        const taskTime = new Date(task.startAt).getTime();
        if (filters.fromDate && taskTime < new Date(`${filters.fromDate}T00:00:00`).getTime()) return false;
        if (filters.toDate && taskTime > new Date(`${filters.toDate}T23:59:59`).getTime()) return false;
        return true;
      }),
    [allArchivedTasks, filters, projectMap, typeMap],
  );
  const groupedTasks = useMemo(() => groupByMonth(archivedTasks), [archivedTasks]);
  const activeFilterCount = countActiveFilters(filters);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const scrollArea = activityScrollRef.current;
      if (scrollArea && scrollArea.scrollWidth > scrollArea.clientWidth) {
        scrollArea.scrollLeft = scrollArea.scrollWidth - scrollArea.clientWidth;
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [yearlyActivity.rangeStartKey, activityMode]);

  function resetFilters() {
    setFilters({ keyword: "", projectId: "", taskTypeId: "", fromDate: "", toDate: "", majorOnly: false });
  }

  function openTask(task: Task) {
    navigate(`/dashboard?date=${encodeURIComponent(getDateKey(task.startAt))}&taskId=${encodeURIComponent(task.id)}`);
  }

  async function reopenTask(task: Task) {
    await updateTask(task.id, {
      title: task.title,
      content: task.content,
      taskTypeId: task.taskTypeId,
      projectId: task.projectId,
      status: "NOT_DONE",
      startAt: task.startAt,
      endAt: task.endAt,
      isMajor: task.isMajor,
    });
  }

  useEffect(() => {
    if (!isLunchCacheReady || allLunchCandidatesRef.current.length < 2) return;
    if (lunchLastAttemptedDateKey === lunchAnalysisDateKey) return;

    const controller = new AbortController();
    const requestId = ++lunchAnalysisRequestIdRef.current;
    const attemptedAt = new Date().toISOString();
    const startTimer = window.setTimeout(() => {
      if (controller.signal.aborted) return;

      const candidates = allLunchCandidatesRef.current.map((candidate) => ({ ...candidate }));
      const previousCache = lunchCacheRef.current;

      void (async () => {
        try {
          setIsAnalyzingLunch(true);
          setLunchAnalysisError("");
          const groups = await analyzeLunchMateAliases({
            candidates,
            endpoint: setting.llmEndpoint,
            apiKey: setting.llmApiKey ?? "",
            model: setting.llmModel,
            generationOptions: lunchGenerationOptions,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;

          const payload = JSON.stringify(groups);
          if (new TextEncoder().encode(payload).byteLength > 500_000) {
            throw new Error("분석 결과가 안전 저장 한도(500KB)를 초과했습니다.");
          }
          await db.archiveInsightCaches.put({
            id: lunchCacheId,
            sourceFingerprint: lunchFingerprint,
            payload,
            lastAttemptedAt: attemptedAt,
            updatedAt: attemptedAt,
          });
        } catch (error: unknown) {
          if (controller.signal.aborted) return;

          const message = error instanceof Error ? error.message : "점심 메이트 이름을 분석하지 못했습니다.";
          setLunchAnalysisError(message);
          try {
            await db.archiveInsightCaches.put({
              id: lunchCacheId,
              sourceFingerprint: previousCache?.sourceFingerprint ?? lunchFingerprint,
              payload: previousCache?.payload ?? "[]",
              lastAttemptedAt: attemptedAt,
              updatedAt: attemptedAt,
            });
          } catch {
            setLunchAnalysisError(`${message} 분석 오류 상태도 저장하지 못했습니다.`);
          }
        } finally {
          if (lunchAnalysisRequestIdRef.current === requestId) {
            setIsAnalyzingLunch(false);
          }
        }
      })();
    }, LUNCH_ANALYSIS_STABILIZATION_MS);

    return () => {
      window.clearTimeout(startTimer);
      controller.abort();
    };
  }, [
    isLunchCacheReady,
    lunchAnalysisDateKey,
    lunchFingerprint,
    lunchGenerationOptions,
    lunchLastAttemptedDateKey,
    setting.llmApiKey,
    setting.llmEndpoint,
    setting.llmModel,
  ]);

  return (
    <section className="archive-workspace archive-record-workspace">
      <header className="archive-hero archive-record-hero">
        <div className="archive-hero-copy">
          <p className="eyebrow">MY RECORDS</p>
          <h2>나의 기록</h2>
          <p className="description-text">완료한 업무와 함께한 사람을 숫자가 아닌 이야기로 돌아봅니다.</p>
          <div className="archive-period-tabs" role="group" aria-label="기록 집계 기간">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={period === option.value ? "active" : ""}
                aria-pressed={period === option.value}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="archive-mockup-card archive-record-summary" aria-label="선택 기간 요약">
          <div className="archive-mockup-top">
            <span>{PERIOD_OPTIONS.find((option) => option.value === period)?.label}</span>
            <strong>{periodCompletedTasks.length}</strong>
          </div>
          <div className="archive-mockup-row sky">
            <span>완료한 업무</span>
            <strong>{periodCompletedTasks.length}개</strong>
          </div>
          <div className="archive-mockup-row mint">
            <span>추가한 업무</span>
            <strong>{periodCreatedTasks.length}개</strong>
          </div>
          <div className="archive-mockup-row blue">
            <span>점심 약속</span>
            <strong>{periodLunchTasks.length}개</strong>
          </div>
        </div>
      </header>

      <section className="archive-activity-card" aria-labelledby="archive-activity-title">
        <header className="archive-activity-header">
          <div>
            <p className="eyebrow">YEARLY ACTIVITY</p>
            <h3 id="archive-activity-title">최근 1년 동안 <strong>{yearlyActivity.total}건</strong> {activityLabel}했어요</h3>
            <p>
              {yearlyActivity.activeDays > 0
                ? `${yearlyActivity.activeDays}일에 기록을 남겼습니다.${
                    yearlyActivity.busiestDay
                      ? ` 가장 활발한 날은 ${formatActivityDay(yearlyActivity.busiestDay.date)} ${yearlyActivity.busiestDay.count}건입니다.`
                      : ""
                  }`
                : `업무를 ${activityLabel}하면 이곳에 하루씩 기록이 쌓입니다.`}
            </p>
          </div>
          <div className="archive-activity-controls">
            <div className="archive-activity-toggle" role="group" aria-label="활동 그래프 기준">
              <button type="button" className={activityMode === "completed" ? "active" : ""} aria-pressed={activityMode === "completed"} onClick={() => setActivityMode("completed")}>완료한 날</button>
              <button type="button" className={activityMode === "created" ? "active" : ""} aria-pressed={activityMode === "created"} onClick={() => setActivityMode("created")}>추가한 날</button>
            </div>
            <span className="archive-activity-range">{formatDateOnly(yearlyActivity.rangeStartKey)} – {formatDateOnly(yearlyActivity.todayKey)}</span>
          </div>
        </header>

        <div ref={activityScrollRef} className="archive-activity-scroll" role="region" tabIndex={0} aria-label={`최근 1년 업무 ${activityLabel} 활동 그래프`}>
          <div className="archive-activity-chart" role="img" aria-label={`날짜별 업무 ${activityLabel} 건수. 총 ${yearlyActivity.total}건`}>
            <div className="archive-activity-month-row" aria-hidden="true">
              <span />
              <div className="archive-activity-months">
                {yearlyActivity.weeks.map((week) => <span key={week.key}>{week.monthLabel}</span>)}
              </div>
            </div>
            <div className="archive-activity-grid-row">
              <div className="archive-activity-weekdays" aria-hidden="true">
                {activityWeekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
              </div>
              <div className="archive-activity-weeks" aria-hidden="true">
                {yearlyActivity.weeks.map((week) => (
                  <div key={week.key} className="archive-activity-week">
                    {week.days.map((day) => (
                      <span
                        key={day.key}
                        className={`archive-activity-cell level-${day.level} ${day.isOutsideRange ? "outside" : ""} ${day.key === yearlyActivity.todayKey ? "today" : ""}`}
                        title={day.isOutsideRange ? undefined : `${formatActivityDay(day.date)} · ${activityLabel} ${day.count}건`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <footer className="archive-activity-footer">
          <span className="archive-activity-scroll-hint">좌우로 밀어 전체 기간 보기</span>
          <div className="archive-activity-legend" aria-label={`${activityLabel} 건수 강도: 적음에서 많음`}>
            <span>적음</span>
            {[0, 1, 2, 3, 4].map((level) => <i key={level} className={`archive-activity-cell level-${level}`} aria-hidden="true" />)}
            <span>많음</span>
          </div>
        </footer>
      </section>

      <section className="archive-record-section" aria-labelledby="archive-record-title">
        <header className="archive-section-heading">
          <div>
            <p className="eyebrow">HIGHLIGHTS</p>
            <h3 id="archive-record-title">기억해 둘 만한 기록</h3>
          </div>
          <span>{PERIOD_OPTIONS.find((option) => option.value === period)?.label} 기준</span>
        </header>
        <div className="archive-record-grid">
          <article className="archive-record-card lunch">
            <div className="archive-record-card-top">
              <span className="archive-record-icon" aria-hidden="true">🍽</span>
              <span className="archive-record-kicker">점심 메이트</span>
              {isAnalyzingLunch ? <span className="archive-ai-badge">AI 정리 중</span> : hasAiLunchAnalysis ? <span className="archive-ai-badge">AI 정리됨</span> : null}
            </div>
            <strong>{topLunchMate?.displayName ?? "아직 기록 없음"}</strong>
            <p>
              {topLunchMate ? `함께 점심 먹은 횟수 : ${topLunchMate.count} 번` : "함께 점심 먹은 횟수 : 0 번"}
            </p>
            {hasAiLunchAnalysis && topLunchMate && topLunchMate.aliases.length > 1 ? <small className="archive-alias-note">{topLunchMate.aliases.join(" · ")} 동일인 분석</small> : null}
            {lunchAnalysisError ? <span className="archive-card-error" role="alert">{lunchAnalysisError}</span> : null}
          </article>

          <article className="archive-record-card focus">
            <div className="archive-record-card-top">
              <span className="archive-record-icon" aria-hidden="true">✓</span>
              <span className="archive-record-kicker">최다 업무 완료일</span>
            </div>
            <strong>{bestCompletionDay ? formatRecordDay(bestCompletionDay.key) : "아직 기록 없음"}</strong>
            <p>하루에 완료한 업무 : {bestCompletionDay?.count ?? 0} 개</p>
          </article>

          <article className="archive-record-card planning">
            <div className="archive-record-card-top">
              <span className="archive-record-icon" aria-hidden="true">＋</span>
              <span className="archive-record-kicker">최다 업무 추가일</span>
            </div>
            <strong>{bestCreatedDay ? formatRecordDay(bestCreatedDay.key) : "아직 기록 없음"}</strong>
            <p>하루에 추가한 업무 : {bestCreatedDay?.count ?? 0} 개</p>
          </article>

          <article className="archive-record-card project">
            <div className="archive-record-card-top">
              <span className="archive-record-icon" aria-hidden="true">◆</span>
              <span className="archive-record-kicker">최다 완료 프로젝트</span>
            </div>
            <strong>{topProjectRecord?.project?.name ?? "아직 기록 없음"}</strong>
            <p>완료한 업무 : {topProjectRecord?.count ?? 0} 개</p>
          </article>
        </div>
      </section>

      <section className="archive-recent-section" aria-labelledby="archive-recent-title">
        <header className="archive-section-heading">
          <div>
            <p className="eyebrow">RECENTLY COMPLETED</p>
            <h3 id="archive-recent-title">최근 완료 일정</h3>
          </div>
          <span>최대 {RECENT_COMPLETED_LIMIT}개</span>
        </header>
        {recentCompletedTasks.length > 0 ? (
          <div className="archive-card-list archive-recent-list">
            {recentCompletedTasks.map((task) => (
              <ArchiveTaskCard
                key={task.id}
                task={task}
                project={projectMap[task.projectId]}
                taskType={typeMap[task.taskTypeId]}
                currentTime={currentTime}
                timeFormat={setting.timeFormat}
                compact
                onOpen={() => openTask(task)}
                onReopen={() => void reopenTask(task)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state archive-empty-state">
            <span className="badge-pill">RECORDS</span>
            <h3>아직 완료 기록이 없습니다.</h3>
            <p>일정을 완료하면 최근 기록과 재미있는 통계가 이곳에 나타납니다.</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate("/dashboard")}>일정 만들기</button>
          </div>
        )}
      </section>

      <section className={`archive-all-records ${showAllRecords ? "open" : ""}`}>
        <button
          type="button"
          className="archive-all-records-toggle"
          aria-expanded={showAllRecords}
          aria-controls="archive-all-records-content"
          onClick={() => setShowAllRecords((value) => !value)}
        >
          <span>
            <strong>전체 완료 기록 검색</strong>
            <small>지난 일정 {allArchivedTasks.length}개를 검색하고 다시 열 수 있어요.</small>
          </span>
          <i aria-hidden="true">⌄</i>
        </button>

        {showAllRecords ? (
          <div id="archive-all-records-content" className="archive-all-records-content">
            <section className="archive-search-bar" aria-label="보관함 검색">
              <label className="search-field">
                검색
                <input type="text" value={filters.keyword} onChange={(event) => setFilters((prev) => ({ ...prev, keyword: event.target.value }))} placeholder="제목, 내용, 프로젝트, 종류 검색" />
              </label>
              <button type="button" className="btn btn-outline" aria-expanded={showFilters} aria-controls="archive-detail-filters" onClick={() => setShowFilters((prev) => !prev)}>
                필터 {activeFilterCount > 0 ? activeFilterCount : ""}
              </button>
              {activeFilterCount > 0 ? <button type="button" className="btn btn-soft" onClick={resetFilters}>필터 초기화</button> : null}
            </section>

            {showFilters ? (
              <section id="archive-detail-filters" className="archive-filter-panel" aria-label="상세 필터">
                <label>프로젝트<select value={filters.projectId} onChange={(event) => setFilters((prev) => ({ ...prev, projectId: event.target.value }))}><option value="">전체</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
                <label>종류<select value={filters.taskTypeId} onChange={(event) => setFilters((prev) => ({ ...prev, taskTypeId: event.target.value }))}><option value="">전체</option>{taskTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
                <label>시작일<input type="date" value={filters.fromDate} onChange={(event) => setFilters((prev) => ({ ...prev, fromDate: event.target.value }))} /></label>
                <label>종료일<input type="date" value={filters.toDate} onChange={(event) => setFilters((prev) => ({ ...prev, toDate: event.target.value }))} /></label>
                <label className="checkbox-inline archive-major-toggle"><input type="checkbox" checked={filters.majorOnly} onChange={(event) => setFilters((prev) => ({ ...prev, majorOnly: event.target.checked }))} />중요 일정만</label>
                <button type="button" className="btn btn-soft" onClick={resetFilters}>필터 초기화</button>
              </section>
            ) : null}

            <section className="archive-list" aria-label="전체 완료 일정">
              {groupedTasks.length === 0 ? (
                <div className="empty-state archive-empty-state">
                  <h3>조건에 맞는 완료 기록이 없습니다.</h3>
                  <button type="button" className="btn btn-soft" onClick={resetFilters}>필터 초기화</button>
                </div>
              ) : null}
              {groupedTasks.map((group, groupIndex) => (
                <section key={group.monthKey} className={`archive-month-group tint-${groupIndex % 4}`}>
                  <header><div><p className="eyebrow">COMPLETED</p><h3>{group.title}</h3></div><span>{group.tasks.length}개</span></header>
                  <div className="archive-card-list">
                    {group.tasks.map((task) => (
                      <ArchiveTaskCard
                        key={task.id}
                        task={task}
                        project={projectMap[task.projectId]}
                        taskType={typeMap[task.taskTypeId]}
                        currentTime={currentTime}
                        timeFormat={setting.timeFormat}
                        onOpen={() => openTask(task)}
                        onReopen={() => void reopenTask(task)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </section>
          </div>
        ) : null}
      </section>
    </section>
  );
}
