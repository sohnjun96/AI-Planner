import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { STATUS_LABELS } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Task } from "../models";
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

const ACTIVITY_WEEK_COUNT = 53;
const ACTIVITY_DAY_COUNT = 365;

function addCalendarDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function getActivityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) {
    return 0;
  }
  if (count === 1) {
    return 1;
  }
  if (count === 2) {
    return 2;
  }
  if (count === 3) {
    return 3;
  }
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

function buildArchiveActivity(tasks: Task[], currentTime: number, weekStartsOn: "sun" | "mon") {
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
    const key = getDateKey(task.completedAt ?? task.startAt);
    if (key < rangeStartKey || key > todayKey) {
      return;
    }
    countByDate.set(key, (countByDate.get(key) ?? 0) + 1);
  });

  const weeks: ArchiveActivityWeek[] = Array.from({ length: ACTIVITY_WEEK_COUNT }, (_, weekIndex) => {
    const weekStart = addCalendarDays(chartStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = addCalendarDays(weekStart, dayIndex);
      const key = getDateKey(date);
      const isOutsideRange = key < rangeStartKey || key > todayKey;
      const count = isOutsideRange ? 0 : (countByDate.get(key) ?? 0);

      return {
        key,
        date,
        count,
        level: getActivityLevel(count),
        isOutsideRange,
      } satisfies ArchiveActivityDay;
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
  const activeDays = activeDayRecords.length;
  const busiestDay = daysInRange.reduce<ArchiveActivityDay | undefined>((busiest, day) => {
    if (!busiest || day.count > busiest.count) {
      return day;
    }
    return busiest;
  }, undefined);

  return {
    weeks,
    total,
    activeDays,
    activeDayRecords,
    busiestDay: busiestDay && busiestDay.count > 0 ? busiestDay : undefined,
    rangeStartKey,
    todayKey,
  };
}

function formatMonthLabel(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(new Date(`${value}-01T00:00:00`));
}

function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatElapsedDays(value: string, currentTime: number): string {
  const diffMs = currentTime - new Date(value).getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (days === 0) {
    return "오늘";
  }
  return `${days}일 전`;
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
  return [
    filters.keyword.trim(),
    filters.projectId,
    filters.taskTypeId,
    filters.fromDate,
    filters.toDate,
    filters.majorOnly,
  ].filter(Boolean).length;
}

export function ArchivePage() {
  const { tasks, projects, taskTypes, setting, updateTask } = useAppData();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [showFilters, setShowFilters] = useState(false);
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
    const timer = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const typeMap = useMemo(() => Object.fromEntries(taskTypes.map((type) => [type.id, type])), [taskTypes]);

  const allArchivedTasks = useMemo(() => {
    return tasks
      .filter((task) => task.status === "DONE" && new Date(task.completedAt ?? task.startAt).getTime() < currentTime)
      .sort(
        (a, b) =>
          new Date(b.completedAt ?? b.startAt).getTime() - new Date(a.completedAt ?? a.startAt).getTime(),
      );
  }, [currentTime, tasks]);

  const archivedTasks = useMemo(() => {
    return allArchivedTasks.filter((task) => {
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
    });
  }, [allArchivedTasks, filters, projectMap, typeMap]);

  const groupedTasks = useMemo(() => groupByMonth(archivedTasks), [archivedTasks]);
  const yearlyActivity = useMemo(
    () => buildArchiveActivity(allArchivedTasks, currentTime, setting.weekStartsOn),
    [allArchivedTasks, currentTime, setting.weekStartsOn],
  );
  const activityWeekdayLabels = setting.weekStartsOn === "mon" ? ["월", "", "수", "", "금", "", ""] : ["", "월", "", "수", "", "금", ""];
  const activeFilterCount = countActiveFilters(filters);
  const importantArchivedCount = allArchivedTasks.filter((task) => task.isMajor).length;
  const latestCompletedTask = allArchivedTasks[0];
  const thisMonthKey = getDateKey(new Date(currentTime)).slice(0, 7);
  const thisMonthCount = allArchivedTasks.filter(
    (task) => getDateKey(task.completedAt ?? task.startAt).slice(0, 7) === thisMonthKey,
  ).length;

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const scrollArea = activityScrollRef.current;
      if (scrollArea && scrollArea.scrollWidth > scrollArea.clientWidth) {
        scrollArea.scrollLeft = scrollArea.scrollWidth - scrollArea.clientWidth;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [yearlyActivity.rangeStartKey]);

  function resetFilters() {
    setFilters({
      keyword: "",
      projectId: "",
      taskTypeId: "",
      fromDate: "",
      toDate: "",
      majorOnly: false,
    });
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

  return (
    <section className="archive-workspace">
      <header className="archive-hero">
        <div className="archive-hero-copy">
          <p className="eyebrow">ARCHIVE</p>
          <h2>완료 기록</h2>
          <p className="description-text">
            끝낸 일정을 월별로 돌아보고, 필요한 기록을 프로젝트와 종류별로 빠르게 찾습니다.
          </p>
        </div>

        <div className="archive-mockup-card" aria-label="보관함 요약">
          <div className="archive-mockup-top">
            <span>완료 기록</span>
            <strong>{allArchivedTasks.length}</strong>
          </div>
          <div className="archive-mockup-row sky">
            <span>검색 결과</span>
            <strong>{archivedTasks.length}개</strong>
          </div>
          <div className="archive-mockup-row mint">
            <span>이번 달</span>
            <strong>{thisMonthCount}개</strong>
          </div>
          <div className="archive-mockup-row blue">
            <span>중요 완료</span>
            <strong>{importantArchivedCount}개</strong>
          </div>
        </div>
      </header>

      <section className="archive-activity-card" aria-labelledby="archive-activity-title">
        <header className="archive-activity-header">
          <div>
            <p className="eyebrow">YEARLY ACTIVITY</p>
            <h3 id="archive-activity-title">
              최근 1년 동안 <strong>{yearlyActivity.total}건</strong> 완료했어요
            </h3>
            <p>
              {yearlyActivity.activeDays > 0
                ? `${yearlyActivity.activeDays}일에 완료 기록을 남겼습니다.${
                    yearlyActivity.busiestDay
                      ? ` 가장 활발한 날은 ${formatActivityDay(yearlyActivity.busiestDay.date)} ${yearlyActivity.busiestDay.count}건입니다.`
                      : ""
                  }`
                : "일정을 완료하면 이곳에 하루씩 파란 기록이 쌓입니다."}
            </p>
          </div>
          <span className="archive-activity-range">
            {formatDateOnly(yearlyActivity.rangeStartKey)} – {formatDateOnly(yearlyActivity.todayKey)}
          </span>
        </header>

        <div
          ref={activityScrollRef}
          className="archive-activity-scroll"
          role="region"
          tabIndex={0}
          aria-label={`최근 1년 완료 활동 그래프. 총 ${yearlyActivity.total}건, 활동한 날 ${yearlyActivity.activeDays}일`}
        >
          <div className="archive-activity-chart" role="img" aria-label={`날짜별 완료 건수. 총 ${yearlyActivity.total}건`}>
            <div className="archive-activity-month-row" aria-hidden="true">
              <span />
              <div className="archive-activity-months">
                {yearlyActivity.weeks.map((week) => (
                  <span key={week.key}>{week.monthLabel}</span>
                ))}
              </div>
            </div>

            <div className="archive-activity-grid-row">
              <div className="archive-activity-weekdays" aria-hidden="true">
                {activityWeekdayLabels.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
              <div className="archive-activity-weeks" aria-hidden="true">
                {yearlyActivity.weeks.map((week) => (
                  <div key={week.key} className="archive-activity-week">
                    {week.days.map((day) => (
                      <span
                        key={day.key}
                        className={`archive-activity-cell level-${day.level} ${day.isOutsideRange ? "outside" : ""} ${
                          day.key === yearlyActivity.todayKey ? "today" : ""
                        }`}
                        title={day.isOutsideRange ? undefined : `${formatActivityDay(day.date)} · 완료 ${day.count}건`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {yearlyActivity.activeDayRecords.length > 0 ? (
          <ul className="sr-only" aria-label="완료 활동이 있었던 날짜">
            {yearlyActivity.activeDayRecords.map((day) => (
              <li key={day.key}>
                {formatActivityDay(day.date)} 완료 {day.count}건
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="archive-activity-footer">
          <span className="archive-activity-scroll-hint">좌우로 밀어 전체 기간 보기</span>
          <div className="archive-activity-legend" aria-label="완료 건수 강도: 적음에서 많음">
            <span>적음</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <i key={level} className={`archive-activity-cell level-${level}`} aria-hidden="true" />
            ))}
            <span>많음</span>
          </div>
        </footer>
      </section>

      <section className="archive-insight-grid" aria-label="보관함 지표">
        <article className="archive-insight-card yellow">
          <span>전체 완료</span>
          <strong>{allArchivedTasks.length}개</strong>
          <p>완료되었고 예정 시간이 지난 일정</p>
        </article>
        <article className="archive-insight-card peach">
          <span>현재 결과</span>
          <strong>{archivedTasks.length}개</strong>
          <p>{activeFilterCount > 0 ? `필터 ${activeFilterCount}개 적용 중` : "전체 기록을 보고 있음"}</p>
        </article>
        <article className="archive-insight-card mint">
          <span>최근 완료</span>
          <strong>{latestCompletedTask ? formatDateOnly(latestCompletedTask.completedAt ?? latestCompletedTask.startAt) : "-"}</strong>
          <p>{latestCompletedTask?.title ?? "아직 지난 완료 일정이 없음"}</p>
        </article>
      </section>

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
        <button
          type="button"
          className="btn btn-outline"
          aria-expanded={showFilters}
          aria-controls="archive-detail-filters"
          onClick={() => setShowFilters((prev) => !prev)}
        >
          필터 {activeFilterCount > 0 ? activeFilterCount : ""}
        </button>
        {activeFilterCount > 0 ? (
          <button type="button" className="btn btn-soft" onClick={resetFilters}>
            필터 초기화
          </button>
        ) : null}
      </section>

      {showFilters ? (
        <section id="archive-detail-filters" className="archive-filter-panel" aria-label="상세 필터">
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

          <label className="checkbox-inline archive-major-toggle">
            <input
              type="checkbox"
              checked={filters.majorOnly}
              onChange={(event) => setFilters((prev) => ({ ...prev, majorOnly: event.target.checked }))}
            />
            중요 일정만
          </label>

          <button type="button" className="btn btn-soft" onClick={resetFilters}>
            필터 초기화
          </button>
        </section>
      ) : null}

      <section className="archive-list" aria-label="지난 완료 일정">
        {groupedTasks.length === 0 ? (
          <div className="empty-state archive-empty-state">
            <span className="badge-pill">ARCHIVE</span>
            <h3>{activeFilterCount > 0 ? "조건에 맞는 완료 기록이 없습니다." : "아직 완료 기록이 없습니다."}</h3>
            <p>
              {activeFilterCount > 0
                ? "검색어나 필터를 바꾸면 다른 완료 기록을 찾을 수 있습니다."
                : "완료한 일정이 생기면 프로젝트와 종류별 기록을 이곳에서 다시 확인할 수 있습니다."}
            </p>
            <div className="button-row">
              {activeFilterCount > 0 ? (
                <button type="button" className="btn btn-soft" onClick={resetFilters}>
                  필터 초기화
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => navigate("/dashboard")}>
                  일정 만들기
                </button>
              )}
            </div>
          </div>
        ) : null}

        {groupedTasks.map((group, groupIndex) => (
          <section key={group.monthKey} className={`archive-month-group tint-${groupIndex % 4}`}>
            <header>
              <div>
                <p className="eyebrow">COMPLETED</p>
                <h3>{group.title}</h3>
              </div>
              <span>{group.tasks.length}개</span>
            </header>

            <div className="archive-card-list">
              {group.tasks.map((task) => {
                const project = projectMap[task.projectId];
                const taskType = typeMap[task.taskTypeId];

                return (
                  <article key={task.id} className="archive-task-card">
                    <div className="archive-task-main">
                      <div className="archive-task-title-row">
                        <strong>{task.title}</strong>
                        {task.isMajor ? <span className="badge-pill warning">중요</span> : null}
                      </div>
                      <span>
                        {formatDateTime(task.startAt, setting.timeFormat)}
                        {task.endAt ? ` - ${formatDateTime(task.endAt, setting.timeFormat)}` : ""}
                      </span>
                      <div className="archive-tag-row">
                        <span style={{ backgroundColor: `${project?.color ?? "#6b7280"}1f`, color: project?.color ?? "#4b5563" }}>
                          {project?.name ?? "프로젝트 없음"}
                        </span>
                        <span style={{ backgroundColor: `${taskType?.color ?? "#6b7280"}1f`, color: taskType?.color ?? "#4b5563" }}>
                          {taskType?.name ?? "종류 없음"}
                        </span>
                        <span className="archive-completed-tag">{task.completedAt ? `완료 ${formatDateOnly(task.completedAt)}` : "완료일 없음"}</span>
                      </div>
                      {task.content ? <p>{task.content}</p> : null}
                    </div>
                    <div className="archive-task-actions">
                      <span className="status-badge done">{STATUS_LABELS.DONE}</span>
                      <span className="archive-elapsed-tag">{formatElapsedDays(task.startAt, currentTime)}</span>
                      <button type="button" className="btn btn-soft btn-compact" onClick={() => openTask(task)}>
                        상세 보기
                      </button>
                      <button type="button" className="btn btn-outline btn-compact" onClick={() => void reopenTask(task)}>
                        미완료로 되돌리기
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </section>
    </section>
  );
}
