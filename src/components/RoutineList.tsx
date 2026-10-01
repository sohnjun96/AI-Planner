import { useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useRoutines } from "../hooks/useRoutines";
import type { Routine } from "../models";
import { useNavigate } from "../routing";
import { actOnRoutine, routineTaskDraft, type RoutineAction } from "../utils/routineStore";
import { addDays, getDateKey } from "../utils/date";
import type { RoutineCycle } from "../utils/routines";
import { RoutineCard } from "./RoutineCard";
import { TaskModal } from "./TaskModal";
import { TaskForm } from "./TaskForm";
import { showToast } from "../utils/toast";

export type RoutineRow = { routine: Routine; cycle: RoutineCycle };

function getRoutineGroup({ routine, cycle }: RoutineRow): number {
  return cycle.ended ? 3 : !routine.isActive ? 2 : cycle.needsAttention ? 0 : 1;
}

export function RoutineList({ rows, groupByStatus = false, onEdit, onToggle, onDelete }: {
  groupByStatus?: boolean;
  rows: RoutineRow[]; onEdit?: (routine: Routine) => void;
  onToggle?: (routine: Routine) => void; onDelete?: (routine: Routine) => void;
}) {
  const { projects, taskTypes, tasks, setting } = useAppData();
  const { records } = useRoutines();
  const [draft, setDraft] = useState<RoutineRow>();
  const [snooze, setSnooze] = useState<RoutineRow>();
  const [snoozeDate, setSnoozeDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const orderedRows = [...rows].sort((a, b) => getRoutineGroup(a) - getRoutineGroup(b)
    || (getRoutineGroup(a) === 0 ? a.cycle.dueDate.localeCompare(b.cycle.dueDate)
      : getRoutineGroup(a) === 1 ? a.cycle.notifyDate.localeCompare(b.cycle.notifyDate) : 0)
    || a.routine.title.localeCompare(b.routine.title, "ko") || a.routine.id.localeCompare(b.routine.id));
  const groupCounts = orderedRows.reduce((counts, row) => {
    counts[getRoutineGroup(row)] += 1; return counts;
  }, [0, 0, 0, 0]);
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
    <div className={`routine-list ${groupByStatus ? "routine-list-grouped" : ""}`}>
      {orderedRows.flatMap((row, index) => {
        const { routine, cycle } = row;
        const history = records.filter((record) => record.routineId === routine.id).sort((a, b) => b.dueDate.localeCompare(a.dueDate) || b.updatedAt.localeCompare(a.updatedAt));
        const group = getRoutineGroup(row);
        const heading = groupByStatus && (index === 0 || group !== getRoutineGroup(orderedRows[index - 1]))
          ? [<h3 key={`group-${group}`} className="routine-list-group-title">{["확인 필요", "예정", "일시 중지", "종료"][group]} <span>{groupCounts[group]}</span></h3>] : [];
        return [...heading, <RoutineCard key={routine.id} routine={routine} cycle={cycle} history={history} busy={busy} grouped={groupByStatus}
          onCreate={() => { setError(""); setDraft(row); }} onAcknowledge={() => void act(row, "acknowledged")}
          onSnooze={() => { setError(""); setSnooze(row); setSnoozeDate(getDateKey(addDays(new Date(), 1))); }} onSkip={() => void act(row, "skipped")}
          onEdit={onEdit} onToggle={onToggle} onDelete={onDelete} />];
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
        <p className="description-text">예정일은 유지됩니다. 선택한 날에 이 회차를 다시 안내합니다.</p>
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
