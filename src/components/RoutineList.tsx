import { useState } from "react";
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
        const history = records.filter((record) => record.routineId === routine.id).sort((a, b) => b.period.localeCompare(a.period));
        return <article key={routine.id} className={`routine-card ${cycle.needsAttention ? "routine-card-due" : ""}`}>
          <div className="routine-card-heading">
            <div><span className={`routine-status ${cycle.needsAttention ? "is-due" : ""}`}>{!routine.isActive ? "일시 중지" : cycle.needsAttention ? "확인 필요" : "안내 예정"}</span>
              <h3>{routine.title}</h3></div>
            <span className="routine-project">{projects.find((project) => project.id === routine.projectId)?.name ?? "프로젝트"}</span>
          </div>
          <p className="routine-summary">{routineFrequency(routine)} · {routine.leadDays ? `${routine.leadDays}일 전 안내` : "당일 안내"} · {routine.mode === "schedule" ? "일정 만들기 제안" : "알림만 받기"}</p>
          {routine.content && <p className="routine-content">{routine.content}</p>}
          <div className="routine-dates"><span>예정일 <strong>{cycle.dueDate}</strong></span><span>안내일 <strong>{cycle.notifyDate}</strong></span></div>
          {cycle.needsAttention && <div className="routine-prompt">
            <p>{routine.mode === "schedule" ? "이번 회차의 일정을 만들까요?" : "챙길 때가 되었어요. 확인하셨나요?"}</p>
            <div className="button-row">
              <button className="btn btn-primary" disabled={busy} onClick={() => routine.mode === "schedule" ? (setError(""), setDraft(row)) : void act(row, "acknowledged")}>{routine.mode === "schedule" ? "일정 만들기" : "확인했어요"}</button>
              <button className="btn btn-soft" disabled={busy} onClick={() => { setError(""); setSnooze(row); setSnoozeDate(getDateKey(addDays(new Date(), 1))); }}>나중에</button>
              <button className="btn btn-outline" disabled={busy} onClick={() => void act(row, "skipped")}>이번 회차 건너뛰기</button>
            </div>
          </div>}
          {onEdit && <div className="routine-card-tools"><button className="btn btn-soft" onClick={() => onEdit(routine)}>수정</button>
            <button className="btn btn-soft" onClick={() => onToggle?.(routine)}>{routine.isActive ? "일시 중지" : "다시 시작"}</button>
            <button className="btn btn-outline" onClick={() => onDelete?.(routine)}>삭제</button></div>}
          {onEdit && history.length > 0 && <details className="routine-history"><summary>처리 이력 {history.length}건</summary><ul>{history.slice(0, 24).map((record) => {
            const linkedTask = tasks.find((task) => task.id === record.taskId);
            return <li key={record.id}><span>{record.dueDate} · {{ created: "일정 생성됨", skipped: "건너뜀", acknowledged: "확인 완료", snoozed: "미룸" }[record.status]}</span>
              {linkedTask ? <button className="btn btn-soft" onClick={() => navigate(`/dashboard?taskId=${encodeURIComponent(linkedTask.id)}`)}>일정 보기</button> : record.taskId ? <small>연결 일정이 삭제되었습니다.</small> : null}</li>;
          })}</ul>{history.length > 24 && <small>최근 24건을 표시합니다.</small>}</details>}
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
