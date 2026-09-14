import { useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useRoutines } from "../hooks/useRoutines";
import type { Routine, RoutineInput } from "../models";
import { getDateKey } from "../utils/date";
import { removeRoutine, saveRoutine } from "../utils/routineStore";
import { getRoutineCycle, validateRoutine } from "../utils/routines";
import { RoutineList } from "../components/RoutineList";
import { TaskModal } from "../components/TaskModal";
import { showToast } from "../utils/toast";
import "./RoutinesPage.css";

function RoutineEditor({ routine, onClose }: { routine?: Routine; onClose: () => void }) {
  const { projects, taskTypes } = useAppData();
  const [form, setForm] = useState<RoutineInput>(() => routine ?? {
    title: "", content: "", projectId: projects.find((p) => p.isActive)?.id ?? "", taskTypeId: taskTypes.find((t) => t.isActive)?.id ?? "",
    intervalMonths: 1, startMonth: getDateKey(new Date()).slice(0, 7), dayOfMonth: 25, time: "09:00", leadDays: 7, mode: "schedule", isActive: true,
  });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  function change<K extends keyof RoutineInput>(key: K, value: RoutineInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value })); setDirty(true); setError("");
  }
  let preview = "";
  try {
    const cycle = getRoutineCycle({ ...validateRoutine({ ...form, title: form.title || "루틴" }), id: "preview", createdAt: "", updatedAt: "" }, []);
    preview = `${cycle.dueDate} 예정 · ${cycle.notifyDate}부터 안내`;
  } catch { /* 입력 중에는 유효한 값에 대해서만 미리보기한다. */ }
  return <TaskModal title={routine ? "루틴 수정" : "나의 루틴 추가"} onCancel={onClose} hasUnsavedChanges={dirty} isBusy={busy}>
    <form className="routine-form" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return; setBusy(true); setError("");
      try { await saveRoutine(form, routine); showToast(routine ? "루틴을 수정했습니다." : "루틴을 등록했습니다. 때가 되면 알려드릴게요."); onClose(); }
      catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다."); }
      finally { setBusy(false); }
    }}>
      <label>어떤 일을 챙길까요?<input autoFocus required maxLength={200} value={form.title} onChange={(event) => change("title", event.target.value)} placeholder="예: 영수증 취합" /></label>
      <div className="routine-form-grid">
        <label>반복 간격<select value={form.intervalMonths} onChange={(event) => change("intervalMonths", Number(event.target.value))}>{Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "매월" : n === 12 ? "매년 (12개월마다)" : `${n}개월마다`}</option>)}</select></label>
        <label>시작 월<input type="month" required min="2000-01" max="2100-12" value={form.startMonth} onChange={(event) => change("startMonth", event.target.value)} /></label>
        <label>예정일<select value={form.dayOfMonth} onChange={(event) => change("dayOfMonth", Number(event.target.value))}>{Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}일</option>)}</select></label>
        <label>며칠 전에 알려드릴까요?<select value={form.leadDays} onChange={(event) => change("leadDays", Number(event.target.value))}>{Array.from({ length: 31 }, (_, i) => i).map((n) => <option key={n} value={n}>{n === 0 ? "당일" : `${n}일 전`}</option>)}</select></label>
      </div>
      <p className="description-text">해당 날짜가 없는 달은 말일로 안내합니다. 몇 달 만에 다시 열어도 가장 최근 회차만 제안합니다.</p>
      <label>안내 방식<select value={form.mode} onChange={(event) => change("mode", event.target.value as RoutineInput["mode"])}><option value="schedule">일정을 만들지 물어보기</option><option value="remind">알림만 받기</option></select></label>
      <div className="routine-form-grid">
        <label>프로젝트<select required value={form.projectId} onChange={(event) => change("projectId", event.target.value)}>{projects.filter((p) => p.isActive || p.id === form.projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>일정 종류<select required value={form.taskTypeId} onChange={(event) => change("taskTypeId", event.target.value)}>{taskTypes.filter((t) => t.isActive || t.id === form.taskTypeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </div>
      {form.mode === "schedule" && <label>일정 기본 시간<input type="time" required value={form.time} onChange={(event) => change("time", event.target.value)} /></label>}
      <label>함께 기억할 내용<textarea rows={3} maxLength={100000} value={form.content} onChange={(event) => change("content", event.target.value)} placeholder="준비할 자료나 처리 순서를 적어두세요." /></label>
      {preview && <p className="routine-preview">{preview}</p>}
      {routine && <p className="description-text">이미 만든 일정과 처리 이력은 그대로 유지됩니다. 변경된 규칙은 아직 처리하지 않은 회차부터 적용됩니다.</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <div className="button-row"><button className="btn btn-primary" disabled={busy}>{busy ? "저장 중…" : routine ? "변경사항 저장" : "루틴 등록"}</button></div>
    </form>
  </TaskModal>;
}

export function RoutinesPage() {
  const { rows, dueCount, ready } = useRoutines();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ routine?: Routine }>();
  const [error, setError] = useState("");
  async function mutate(operation: () => Promise<void>) {
    setError(""); try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "처리하지 못했습니다."); }
  }
  const filtered = rows.filter(({ routine, cycle }) => (filter === "all" || (filter === "due" ? cycle.needsAttention : filter === "paused" ? !routine.isActive : routine.isActive && !cycle.needsAttention)) && `${routine.title} ${routine.content}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="routines-page">
    <header className="routine-page-header"><div><p className="eyebrow">MY ROUTINES</p><h2>나의 루틴</h2><p>때가 되면 미리 알려드릴게요.</p></div><button className="btn btn-primary" onClick={() => setEditor({})}>+ 루틴 추가</button></header>
    <div className="routine-page-note">반복 규칙을 등록해 두면 대시보드에서 이번 회차의 일정을 제안합니다. 확장 프로그램은 설정의 ‘일정 시작 전 플래나이 창 표시’를 켜면 안내일 오전 9시에도 알려드립니다.</div>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="routine-toolbar"><div className="routine-filters" aria-label="루틴 필터">{[["all", `전체 ${rows.length}`], ["due", `확인 필요 ${dueCount}`], ["upcoming", "예정"], ["paused", "일시 중지"]].map(([id, label]) => <button key={id} className={`btn ${filter === id ? "btn-primary" : "btn-soft"}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><input type="search" aria-label="루틴 검색" placeholder="루틴 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!ready ? <p role="status">루틴을 불러오는 중…</p> : rows.length === 0 ? <section className="routine-empty"><span aria-hidden="true">↻</span><h3>매번 기억하지 않아도 괜찮아요.</h3><p>매달 25일 영수증 취합, 3개월마다 장비 점검.<br />한 번 등록하고 챙길 때만 안내받으세요.</p><button className="btn btn-primary" onClick={() => setEditor({})}>첫 루틴 등록하기</button></section> : filtered.length === 0 ? <p className="empty-text">조건에 맞는 루틴이 없습니다.</p> :
      <RoutineList rows={filtered} onEdit={(routine) => setEditor({ routine })} onToggle={(routine) => void mutate(() => saveRoutine({ ...routine, isActive: !routine.isActive }, routine))}
        onDelete={(routine) => { if (window.confirm(`‘${routine.title}’ 루틴과 처리 이력을 삭제할까요? 이미 만든 일정은 유지됩니다.`)) void mutate(() => removeRoutine(routine.id)); }} />}
    {editor && <RoutineEditor routine={editor.routine} onClose={() => setEditor(undefined)} />}
  </div>;
}
