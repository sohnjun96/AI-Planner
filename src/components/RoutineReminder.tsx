import { useRef, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import type { Routine } from "../models";
import { useNavigate } from "../routing";
import { addDays, formatDateTime, getDateKey } from "../utils/date";
import { actOnRoutine, routineTaskDraft } from "../utils/routineStore";
import { routineFrequency, type RoutineCycle } from "../utils/routines";
import { showToast } from "../utils/toast";
import { TaskForm } from "./TaskForm";
import { TaskModal } from "./TaskModal";

type ReminderRow = { routine: Routine; cycle: RoutineCycle };

export function RoutineReminder({ rows }: { rows: ReminderRow[] }) {
  const [selectedId, setSelectedId] = useState("");
  const [collapsedFor, setCollapsedFor] = useState("");
  const queueKey = rows.map(({ routine, cycle }) => `${cycle.id}:${cycle.notifyDate}:${routine.updatedAt}`).join("|");
  if (!rows.length) return null;
  const index = Math.max(0, rows.findIndex(({ routine }) => routine.id === selectedId));
  const row = rows[index];

  if (collapsedFor === queueKey) {
    return <button type="button" className="routine-reminder-collapsed" onClick={() => setCollapsedFor("")}
      aria-label={`루틴 알림 펼치기, 확인할 루틴 ${rows.length}건`} aria-expanded={false}>
      <span aria-hidden="true">↻</span><strong>챙길 루틴 {rows.length}건</strong><span>펼치기</span>
    </button>;
  }

  return <RoutineReminderCard key={`${row.cycle.id}:${row.cycle.notifyDate}:${row.routine.updatedAt}`}
    row={row} count={rows.length} index={index}
    onCollapse={() => setCollapsedFor(queueKey)}
    onSelect={(offset) => {
      setSelectedId(rows[(index + offset + rows.length) % rows.length].routine.id);
      // The card resets its form/error state when the selected cycle changes.
      // Keep keyboard navigation on the equivalent button in the next card.
      window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(
        `.routine-reminder [aria-label="${offset > 0 ? "다음" : "이전"} 루틴 알림"]`,
      )?.focus());
    }} />;
}

function RoutineReminderCard({ row, count, index, onCollapse, onSelect }: {
  row: ReminderRow; count: number; index: number; onCollapse: () => void; onSelect: (offset: number) => void;
}) {
  const { projects, taskTypes, tasks, setting } = useAppData();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const { routine, cycle } = row;
  const isSchedule = routine.mode === "schedule";
  const draft = routineTaskDraft(routine, cycle.dueDate);
  const dateLabel = isSchedule ? formatDateTime(draft.startAt, setting.timeFormat)
    : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
      .format(new Date(`${cycle.dueDate}T12:00:00`));
  const memo = routine.content.replace(/\s+/g, " ").trim();

  async function handleAction(action: "created" | "acknowledged" | "snoozed") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try {
      await actOnRoutine(routine, cycle.id, action, action === "created" ? draft : undefined,
        action === "snoozed" ? getDateKey(addDays(new Date(), 1)) : undefined);
      showToast(action === "created" ? "이번 회차의 일정을 만들었습니다."
        : action === "snoozed" ? "내일 다시 알려드릴게요." : "이번 회차를 확인했습니다.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "루틴을 처리하지 못했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <>
    <aside className="routine-reminder" role="region" aria-label="나의 루틴 알림" aria-live="polite" aria-busy={busy}>
      <header className="routine-reminder-header">
        <div className="routine-reminder-label"><span aria-hidden="true">↻</span> 나의 루틴 <span className="routine-reminder-count">{count}건</span></div>
        <button type="button" className="routine-reminder-text-button" aria-label="루틴 알림 접기" aria-expanded={true}
          disabled={busy} onClick={onCollapse}>접기</button>
      </header>
      <p className="routine-reminder-prompt">{isSchedule ? "이 일정을 만들까요?" : "챙길 때가 되었어요"}</p>
      <h2>{routine.title}</h2>
      <div className="routine-reminder-summary">
        <p className="routine-reminder-date"><span>{isSchedule ? "생성할 일정" : "예정일"}</span><time dateTime={isSchedule ? draft.startAt : cycle.dueDate}>{dateLabel}</time></p>
        <div className="routine-reminder-tags">
          <span>{projects.find((project) => project.id === routine.projectId)?.name ?? "프로젝트"}</span>
          <span>{taskTypes.find((taskType) => taskType.id === routine.taskTypeId)?.name ?? "일정 종류"}</span>
        </div>
        {memo && <p className="routine-reminder-memo">{memo.length > 140 ? `${memo.slice(0, 140)}…` : memo}</p>}
      </div>
      <p className="routine-reminder-frequency">{routineFrequency(routine)} · {routine.leadDays ? `${routine.leadDays}일 전 안내` : "당일 안내"}</p>
      {error && <p className="routine-reminder-error" role="alert">{error}</p>}
      <div className="routine-reminder-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleAction(isSchedule ? "created" : "acknowledged")}>
          {busy ? "처리 중…" : isSchedule ? "일정 만들기" : "확인했어요"}
        </button>
        {isSchedule && <button type="button" className="btn btn-soft" disabled={busy} onClick={() => setEditing(true)}>수정 후 만들기</button>}
      </div>
      <footer className="routine-reminder-footer">
        <button type="button" className="routine-reminder-text-button" disabled={busy} onClick={() => void handleAction("snoozed")}>내일 다시 알림</button>
        <button type="button" className="routine-reminder-text-button" disabled={busy} onClick={() => { onCollapse(); navigate("/routines"); }}>전체 보기</button>
        {count > 1 && <div className="routine-reminder-pagination" role="group" aria-label="루틴 알림 순서">
          <button type="button" aria-label="이전 루틴 알림" disabled={busy} onClick={() => onSelect(-1)}>‹</button>
          <span>{index + 1} / {count}</span>
          <button type="button" aria-label="다음 루틴 알림" disabled={busy} onClick={() => onSelect(1)}>›</button>
        </div>}
      </footer>
    </aside>
    {editing && <TaskModal title="루틴에서 일정 만들기" onCancel={() => setEditing(false)}>
      <TaskForm projects={projects} taskTypes={taskTypes} allTasks={tasks} timeFormat={setting.timeFormat}
        initialInput={draft} allowRecurrence={false} onCancel={() => setEditing(false)} onSubmit={async (input) => {
          await actOnRoutine(routine, cycle.id, "created", input);
          setEditing(false); showToast("이번 회차의 일정을 만들었습니다.");
        }} />
    </TaskModal>}
  </>;
}
