import { useId, useRef, useState, type CSSProperties } from "react";
import { useAppData } from "../context/AppDataContext";
import type { Routine, RoutineOccurrence } from "../models";
import { useNavigate } from "../routing";
import { routineFrequency, type RoutineCycle } from "../utils/routines";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import "./RoutineCard.css";

interface RoutineCardProps {
  routine: Routine;
  cycle: RoutineCycle;
  history: RoutineOccurrence[];
  busy: boolean;
  grouped: boolean;
  onCreate: () => void;
  onAcknowledge: () => void;
  onSnooze: () => void;
  onSkip: () => void;
  onEdit?: (routine: Routine) => void;
  onToggle?: (routine: Routine) => void;
  onDelete?: (routine: Routine) => void;
}

function formatRoutineDate(value: string, weekday = false): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    month: "long", day: "numeric", weekday: weekday ? "short" : undefined,
  }).format(date);
}

export function RoutineCard({ routine, cycle, history, busy, grouped, onCreate, onAcknowledge,
  onSnooze, onSkip, onEdit, onToggle, onDelete }: RoutineCardProps) {
  const { projects, tasks } = useAppData();
  const navigate = useNavigate();
  const detailsId = useId();
  const detailsToggle = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const project = projects.find((item) => item.id === routine.projectId);
  const frequency = routineFrequency(routine);
  // Recurrence summaries separate exception/end conditions from the base rule.
  const shortFrequency = frequency.split(" · ")[0];
  const ended = Boolean(cycle.ended);
  const paused = !routine.isActive && !ended;
  const snoozed = cycle.record?.status === "snoozed";
  const createsSchedule = routine.mode !== "remind";
  const status = ended ? "반복 종료" : paused ? "일시 중지" : cycle.needsAttention ? routine.mode === "auto" ? "자동 생성 대기" : "확인 필요" : snoozed ? "다시 알림" : "예정";
  const menuItems: ContextMenuItem[] = [];
  if (onEdit) menuItems.push({ id: "edit", label: "수정", disabled: busy, onSelect: () => onEdit(routine) });
  if (onToggle && !ended && !paused) menuItems.push({ id: "pause", label: "일시 중지", disabled: busy, onSelect: () => onToggle(routine) });
  if (cycle.needsAttention) menuItems.push({ id: "skip", label: "이번 회차 건너뛰기", disabled: busy, onSelect: onSkip });
  if (onDelete) menuItems.push({ id: "delete", label: "삭제", tone: "danger", disabled: busy, onSelect: () => onDelete(routine) });

  return <article className={`routine-card ${cycle.needsAttention ? "routine-card-due" : ""} ${paused ? "routine-card-paused" : ""}`}
    style={{ "--routine-project-color": project?.color ?? "var(--body-muted)" } as CSSProperties}>
    <div className="routine-card-heading">
      <div className="routine-card-labels">
        <span className="routine-project"><span aria-hidden="true" className="routine-project-dot" />{project?.name ?? "프로젝트 없음"}</span>
        {!grouped && <span className={`routine-status ${cycle.needsAttention ? "is-due" : ""}`}>{status}</span>}
        {routine.mode === "remind" && cycle.needsAttention && <span className="routine-status">알림만</span>}
      </div>
      {menuItems.length > 0 && <button type="button" className="routine-more-button" aria-label={`${routine.title} 더보기`}
        aria-haspopup="menu" aria-expanded={Boolean(menu)} disabled={busy} onClick={(event) => {
          event.currentTarget.focus();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu(menu ? undefined : { x: rect.right, y: rect.bottom + 4 });
        }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
      </button>}
    </div>
    <div className="routine-card-title-row">
      <h3 className="routine-card-title" aria-label={routine.title}>
        {onEdit ? <button type="button" className="routine-title-edit" aria-label={`${routine.title} 수정`}
          aria-haspopup="dialog" disabled={busy} onClick={() => onEdit(routine)}>
          <span className="routine-title-text">{routine.title}</span>
        </button> : <span className="routine-title-text">{routine.title}</span>}
      </h3>
      <button ref={detailsToggle} type="button" className="routine-details-toggle" aria-label={`${routine.title} 상세`} aria-expanded={expanded}
        aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>
        <span className="routine-details-label" aria-hidden="true">상세
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </button>
    </div>
    <div className="routine-card-schedule">
      <div className="routine-card-dates">
        {!ended && !paused && <time className="routine-due-date" dateTime={cycle.dueDate}>{formatRoutineDate(cycle.dueDate, true)}</time>}
        {ended && <span className="routine-due-date">반복 종료</span>}
        <span className="routine-summary">{shortFrequency}</span>
      </div>
      {paused && onToggle && <button type="button" className="btn btn-soft routine-resume" disabled={busy} onClick={() => { detailsToggle.current?.focus(); onToggle(routine); }}>다시 시작</button>}
      {ended && onEdit && <button type="button" className="btn btn-soft routine-resume" disabled={busy} onClick={() => onEdit(routine)}>반복 설정</button>}
    </div>
    {!ended && !paused && (snoozed || !cycle.needsAttention || cycle.adjusted) && <p className="routine-notify-date">
      {(snoozed || !cycle.needsAttention) && <><time dateTime={cycle.notifyDate}>{formatRoutineDate(cycle.notifyDate)}</time> {routine.mode === "auto" ? snoozed ? "자동 생성 재시도" : "자동 생성" : snoozed ? "다시 알림" : cycle.notifyDate === cycle.dueDate ? "당일 알림" : "알림"}</>}
      {cycle.adjusted && <span>{snoozed || !cycle.needsAttention ? " · " : ""}날짜 조정됨</span>}
    </p>}
    {cycle.needsAttention && <div className="routine-prompt">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={createsSchedule ? onCreate : () => { detailsToggle.current?.focus(); onAcknowledge(); }}>{createsSchedule ? "일정 만들기" : "확인했어요"}</button>
      <button type="button" className="btn btn-soft" disabled={busy} onClick={onSnooze}>나중에</button>
    </div>}
    <div id={detailsId} className="routine-card-details" hidden={!expanded}>
      <dl className="routine-detail-fields">
        <dt>반복</dt><dd>{frequency}</dd>
        <dt>{routine.mode === "auto" ? "자동 생성" : "알림"}</dt><dd>{paused ? "일시 중지 · " : ""}{routine.leadDays === 0 ? "당일" : `${routine.leadDays}일 전`} · {routine.mode === "auto" ? "일정 자동으로 만들기" : routine.mode === "schedule" ? "일정 만들기 제안" : "알림만 받기"}</dd>
        {!ended && cycle.adjusted && <><dt>날짜 조정</dt><dd>{cycle.sourceDates?.map((date) => formatRoutineDate(date)).join(", ")} → {formatRoutineDate(cycle.dueDate)}</dd></>}
        {routine.content && <><dt>메모</dt><dd className="routine-content">{routine.content}</dd></>}
      </dl>
      <div className="routine-history">
        <h4>처리 이력 <span>{history.length}</span></h4>
        {history.length === 0 ? <p className="routine-history-empty">아직 처리 이력이 없어요.</p> : <ul>{history.slice(0, 24).map((record) => {
          const linkedTask = tasks.find((task) => task.id === record.taskId);
          return <li key={record.id}><span><time dateTime={record.dueDate}>{formatRoutineDate(record.dueDate)}</time> · {{ created: "일정 생성", skipped: "건너뜀", acknowledged: "확인", snoozed: "미룸" }[record.status]}
            {record.status === "snoozed" && record.snoozedUntil && <small><time dateTime={record.snoozedUntil}>{formatRoutineDate(record.snoozedUntil)}</time> 다시 알림</small>}
          </span>{linkedTask ? <button type="button" className="btn btn-soft" onClick={() => navigate(`/dashboard?taskId=${encodeURIComponent(linkedTask.id)}`)}>일정 보기</button> : record.taskId ? <small>연결 일정이 삭제되었습니다.</small> : null}</li>;
        })}</ul>}
        {history.length > 24 && <p className="routine-history-empty">최근 24건을 표시합니다.</p>}
      </div>
    </div>
    {menu && menuItems.length > 0 && <ContextMenu x={menu.x} y={menu.y} align="end" anchored title={routine.title} items={menuItems} onClose={() => setMenu(undefined)} />}
  </article>;
}
