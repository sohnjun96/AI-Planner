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
    <header className="routine-page-header"><div><p className="eyebrow">MY ROUTINES</p><h2>나의 루틴</h2><p>때가 되면 미리 알려드릴게요.</p></div><button className="btn btn-primary" onClick={() => setEditor({})}>+ 루틴 추가</button></header>
    <div className="routine-page-note">안내일에 일정을 만들지 물어보거나, 자동으로 만들거나, 알림만 받을 수 있습니다. 자동 생성은 앱이 열려 있으면 안내일에, 닫혀 있으면 다음에 열 때 실행합니다. 예정일이 지난 미처리 회차는 가장 최근 한 회차만 만듭니다. 확장 프로그램 안내는 설정의 ‘일정 시작 전 플래나이 창 표시’를 켜면 오전 9시에 표시됩니다.</div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="routine-toolbar"><div className="routine-filters" aria-label="루틴 필터">{[["all", `전체 ${rows.length}`], ["due", `확인 필요 ${dueCount}`], ["upcoming", "예정"], ["paused", "일시 중지"], ["ended", "종료"]].map(([id, label]) => <button key={id} className={`btn ${filter === id ? "btn-primary" : "btn-soft"}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><input type="search" aria-label="루틴 검색" placeholder="루틴 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!ready ? <p role="status">루틴을 불러오는 중…</p> : rows.length === 0 ? <section className="routine-empty"><span aria-hidden="true">↻</span><h3>매번 기억하지 않아도 괜찮아요.</h3><p>매주 월·수·금 운동, 매월 1·15일 영수증 취합.<br />한 번 등록하고 챙길 때만 안내받으세요.</p><button className="btn btn-primary" onClick={() => setEditor({})}>첫 루틴 등록하기</button></section> : filtered.length === 0 ? <p className="empty-text">조건에 맞는 루틴이 없습니다.</p> :
      <RoutineList rows={filtered} groupByStatus={filter === "all"} onEdit={(routine) => setEditor({ routine })} onToggle={(routine) => void mutate(() => saveRoutine({ ...routine, isActive: !routine.isActive }, routine))}
        onDelete={(routine) => { if (window.confirm(`‘${routine.title}’ 루틴과 처리 이력을 삭제할까요? 이미 만든 일정은 유지됩니다.`)) void mutate(() => removeRoutine(routine.id)); }} />}
    {editor && <RoutineEditor routine={editor.routine} onClose={() => setEditor(undefined)} />}
  </div>;
}
