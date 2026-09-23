import { useState, type CSSProperties } from "react";
import { useAppData } from "../context/AppDataContext";
import { useRoutines } from "../hooks/useRoutines";
import type { Routine } from "../models";
import { useNavigate } from "../routing";
import { actOnRoutine, routineTaskDraft, type RoutineAction } from "../utils/routineStore";
import { addDays, getDateKey } from "../utils/date";
import { routineFrequency, type RoutineCycle } from "../utils/routines";
import { TaskModal } from "./TaskModal";
import { TaskForm } from "./TaskForm";
import { showToast } from "../utils/toast";

export type RoutineRow = { routine: Routine; cycle: RoutineCycle };

function formatRoutineDate(value: string, weekday = false): string {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    month: "long", day: "numeric", weekday: weekday ? "short" : undefined,
  }).format(date);
}

export function RoutineList({ rows, onEdit, onToggle, onDelete }: {
  rows: RoutineRow[]; onEdit?: (routine: Routine) => void;
  onToggle?: (routine: Routine) => void; onDelete?: (routine: Routine) => void;
}) {
  const { projects, taskTypes, tasks, setting } = useAppData();
  const { records } = useRoutines();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<RoutineRow>();
  const [snooze, setSnooze] = useState<RoutineRow>();
  const [snoozeDate, setSnoozeDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(row: RoutineRow, action: RoutineAction, date?: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await actOnRoutine(row.routine, row.cycle.id, action, undefined, date);
      setSnooze(undefined);
      showToast(action === "skipped" ? "이번 회차를 건너뛰었습니다." : action === "snoozed" ? "선택한 날에 다시 알려드릴게요." : "이번 회차를 확인했습니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="routine-list">
      {rows.map((row) => {
        const { routine, cycle } = row;
        const project = projects.find((item) => item.id === routine.projectId);
        const history = records.filter((record) => record.routineId === routine.id).sort((a, b) => b.period.localeCompare(a.period));
        return <article key={routine.id}
          className={`routine-card ${cycle.needsAttention ? "routine-card-due" : ""} ${!routine.isActive ? "routine-card-paused" : ""}`}
          style={{ "--routine-project-color": project?.color ?? "var(--body-muted)" } as CSSProperties}>
          <div className="routine-card-heading">
            <span className="routine-project"><span aria-hidden="true" className="routine-project-dot" />{project?.name ?? "프로젝트 없음"}</span>
            {(!routine.isActive || cycle.needsAttention) && <span className={`routine-status ${cycle.needsAttention ? "is-due" : ""}`}>{!routine.isActive ? "일시 중지" : "확인 필요"}</span>}
          </div>
          <div className="routine-card-title">
            <h3>{routine.title}</h3>
            <p className="routine-summary">{routineFrequency(routine)}{routine.mode === "remind" && <span>알림만</span>}</p>
          </div>
          <div className="routine-dates">
            <div><span className="routine-date-label">예정</span><time dateTime={cycle.dueDate} title={cycle.dueDate}>{formatRoutineDate(cycle.dueDate, true)}</time></div>
            <span className="routine-notify-date">{!routine.isActive ? "알림 중지" : cycle.notifyDate === cycle.dueDate ? "당일 알림" : <><time dateTime={cycle.notifyDate} title={cycle.notifyDate}>{formatRoutineDate(cycle.notifyDate)}</time> 알림</>}</span>
          </div>
          {cycle.needsAttention && <div className="routine-prompt">
            <div className="button-row">
              <button className="btn btn-primary" disabled={busy} onClick={() => routine.mode === "schedule" ? (setError(""), setDraft(row)) : void act(row, "acknowledged")}>{routine.mode === "schedule" ? "일정 만들기" : "확인했어요"}</button>
              <button className="btn btn-soft" disabled={busy} onClick={() => { setError(""); setSnooze(row); setSnoozeDate(getDateKey(addDays(new Date(), 1))); }}>나중에</button>
              <button className="btn routine-skip" aria-label="이번 회차 건너뛰기" disabled={busy} onClick={() => void act(row, "skipped")}>건너뛰기</button>
            </div>
          </div>}
          {routine.content && <details className="routine-memo"><summary>메모</summary><p className="routine-content">{routine.content}</p></details>}
          {onEdit && history.length > 0 && <details className="routine-history"><summary>처리 이력 <span>{history.length}</span></summary><ul>{history.slice(0, 24).map((record) => {
            const linkedTask = tasks.find((task) => task.id === record.taskId);
            return <li key={record.id}><span>{record.dueDate} · {{ created: "일정 생성됨", skipped: "건너뜀", acknowledged: "확인 완료", snoozed: "미룸" }[record.status]}</span>
              {linkedTask ? <button className="btn btn-soft" onClick={() => navigate(`/dashboard?taskId=${encodeURIComponent(linkedTask.id)}`)}>일정 보기</button> : record.taskId ? <small>연결 일정이 삭제되었습니다.</small> : null}</li>;
          })}</ul>{history.length > 24 && <small>최근 24건을 표시합니다.</small>}</details>}
          {onEdit && <div className="routine-card-tools"><button className="btn routine-edit" onClick={() => onEdit(routine)}>수정</button>
            {onToggle && <button className="btn" onClick={() => onToggle(routine)}>{routine.isActive ? "일시 중지" : "다시 시작"}</button>}
            {onDelete && <button className="btn routine-delete" aria-label="삭제" title="루틴 삭제" onClick={() => onDelete(routine)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" /></svg>
              <span>삭제</span>
            </button>}</div>}
        </article>;
      })}
    </div>
    {draft && <TaskModal title="루틴에서 일정 만들기" onCancel={() => setDraft(undefined)}>
      <TaskForm projects={projects} taskTypes={taskTypes} allTasks={tasks} timeFormat={setting.timeFormat}
        initialInput={routineTaskDraft(draft.routine, draft.cycle.dueDate)} allowRecurrence={false}
        onCancel={() => setDraft(undefined)} onSubmit={async (input) => {
          await actOnRoutine(draft.routine, draft.cycle.id, "created", input);
          setDraft(undefined); showToast("이번 회차의 일정을 만들었습니다.");
        }} />
    </TaskModal>}
    {snooze && <TaskModal title="언제 다시 알려드릴까요?" onCancel={() => setSnooze(undefined)} isBusy={busy}>
      <form className="routine-form" onSubmit={(event) => { event.preventDefault(); void act(snooze, "snoozed", snoozeDate); }}>
        <p>{snooze.routine.title} · {snooze.cycle.dueDate} 예정</p>
        <div className="button-row">{[1, 3, 7].map((days) => <button key={days} type="button" className="btn btn-soft" onClick={() => setSnoozeDate(getDateKey(addDays(new Date(), days)))}>{days === 1 ? "내일" : `${days}일 뒤`}</button>)}</div>
        <label>다시 안내할 날짜<input type="date" required min={getDateKey(addDays(new Date(), 1))} value={snoozeDate} onChange={(event) => setSnoozeDate(event.target.value)} /></label>
        <p className="description-text">예정일은 유지됩니다. 다음 회차 안내일이 먼저 오면 그 회차를 안내합니다.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? "저장 중…" : "이날 다시 알려주세요"}</button>
      </form>
    </TaskModal>}
  </>;
}

export function DashboardRoutines() {
  const { rows, dueCount } = useRoutines();
  const navigate = useNavigate();
  if (!dueCount) return null;
  return <section className="dashboard-routines" aria-label="확인할 나의 루틴"><header className="panel-header"><div><p className="eyebrow">MY ROUTINES</p><h2>챙길 때가 되었어요 <span>{dueCount}</span></h2></div><button className="btn btn-soft" onClick={() => navigate("/routines")}>나의 루틴 전체 보기</button></header>
    <RoutineList rows={rows.filter((row) => row.cycle.needsAttention).slice(0, 3)} />
    {dueCount > 3 && <p className="description-text">확인할 루틴이 {dueCount - 3}개 더 있습니다.</p>}
  </section>;
}
