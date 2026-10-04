import { useState } from "react";
import { useRoutines } from "../hooks/useRoutines";
import type { Routine } from "../models";
import { removeRoutine, saveRoutine } from "../utils/routineStore";
import { RoutineList } from "../components/RoutineList";
import { RoutineEditor } from "../components/RoutineEditor";
import "./RoutinesPage.css";

export function RoutinesPage() {
  const { rows, dueCount, ready } = useRoutines();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ routine?: Routine }>();
  const [error, setError] = useState("");
  async function mutate(operation: () => Promise<void>) {
    setError(""); try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "처리하지 못했습니다."); }
  }
  const filtered = rows.filter(({ routine, cycle }) => {
    const matchesFilter = filter === "all" || (filter === "due" ? cycle.needsAttention : filter === "paused" ? !routine.isActive && !cycle.ended : filter === "ended" ? cycle.ended : routine.isActive && !cycle.needsAttention && !cycle.ended);
    return matchesFilter && `${routine.title} ${routine.content}`.toLowerCase().includes(search.toLowerCase());
  });
  return <div className="routines-page">
    <header className="routine-page-header">
      <div className="routine-page-copy">
        <p className="eyebrow">MY ROUTINES</p>
        <h2>나의 루틴</h2>
        <p className="description-text">반복할 일을 등록하고, 알림을 받거나 일정을 자동으로 만들 수 있습니다.</p>
      </div>
      <button className="btn btn-primary" onClick={() => setEditor({})}>+ 루틴 추가</button>
    </header>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="routine-toolbar"><div className="overview-stat-row routine-filters" aria-label="루틴 필터">{[["all", `전체 ${rows.length}`, "all"], ["due", `확인 필요 ${dueCount}`, "week-filter"], ["upcoming", "예정", "active-filter"], ["paused", "일시 중지", "done-filter"], ["ended", "종료", "done-filter"]].map(([id, label, tone]) => <button key={id} type="button" className={`overview-stat-button ${tone} ${filter === id ? "active" : ""}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><input type="search" aria-label="루틴 검색" placeholder="루틴 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!ready ? <p role="status">루틴을 불러오는 중…</p> : rows.length === 0 ? <section className="routine-empty"><h3>등록된 루틴이 없습니다.</h3><button className="btn btn-primary" onClick={() => setEditor({})}>루틴 추가</button></section> : filtered.length === 0 ? <p className="empty-text">조건에 맞는 루틴이 없습니다.</p> :
      <RoutineList rows={filtered} groupByStatus={filter === "all"} onEdit={(routine) => setEditor({ routine })} onToggle={(routine) => void mutate(() => saveRoutine({ ...routine, isActive: !routine.isActive }, routine))}
        onDelete={(routine) => { if (window.confirm(`‘${routine.title}’ 루틴과 처리 이력을 삭제할까요? 이미 만든 일정은 유지됩니다.`)) void mutate(() => removeRoutine(routine.id)); }} />}
    {editor && <RoutineEditor routine={editor.routine} onClose={() => setEditor(undefined)} />}
  </div>;
}
