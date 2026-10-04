import { useId, useRef, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useRoutines } from "../hooks/useRoutines";
import type { Routine, RoutineInput, RoutineRecurrence } from "../models";
import { getDateKey } from "../utils/date";
import { saveRoutine } from "../utils/routineStore";
import { createDefaultRoutineRule, getRoutinePreview, getRoutineRule, isCalendarDate, routineFrequency, validateRoutine, type RoutineCycle } from "../utils/routines";
import { showToast } from "../utils/toast";
import { TaskModal } from "./TaskModal";
import "./RoutineEditor.css";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const FREQUENCIES = [["daily", "매일", "일"], ["weekly", "매주", "주"], ["monthly", "매월", "개월"], ["yearly", "매년", "년"]] as const;
const DAY_CHOICES = [...Array.from({ length: 31 }, (_, index) => index + 1), "last"] as Array<number | "last">;
const numberValue = (value: string) => value === "" ? Number.NaN : Number(value);
const inputNumber = (value: number) => Number.isFinite(value) ? value : "";

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", { year: date.slice(0, 4) !== String(new Date().getFullYear()) ? "numeric" : undefined, month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function SelectionGrid<T extends number | "last">({ legend, options, selected, label, onChange, className = "" }: {
  legend: string; options: T[]; selected: T[]; label: (value: T) => { text: string; accessible: string };
  onChange: (values: T[]) => void; className?: string;
}) {
  return <fieldset className="routine-choice-fieldset"><legend>{legend}<span className="routine-editor-help">여러 개 선택할 수 있어요.</span></legend>
    <div className={`routine-choice-grid ${className}`}>{options.map((value) => {
      const item = label(value);
      return <label key={value} className={`routine-choice ${value === "last" ? "routine-choice-last" : ""}`}>
        <input type="checkbox" aria-label={item.accessible} checked={selected.includes(value)} onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))} />
        <span>{item.text}</span>
      </label>;
    })}</div>
  </fieldset>;
}

export function RoutineEditor({ routine, onClose }: { routine?: Routine; onClose: () => void }) {
  const { projects, taskTypes } = useAppData();
  const { records } = useRoutines();
  const formId = useId();
  const savingRef = useRef(false);
  const [form, setForm] = useState<RoutineInput>(() => routine ? { ...routine, recurrence: getRoutineRule(routine) } : {
    title: "", content: "", projectId: projects.find((project) => project.isActive)?.id ?? "",
    taskTypeId: taskTypes.find((type) => type.isActive)?.id ?? "", recurrence: { ...createDefaultRoutineRule(), frequency: "weekly", weekdays: [1, 3, 5] },
    time: "09:00", leadDays: 0, mode: "schedule", isActive: true,
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [excludeDate, setExcludeDate] = useState("");
  const [excludeError, setExcludeError] = useState("");
  const [customLead, setCustomLead] = useState(![0, 1, 3, 7].includes(form.leadDays));
  const rule = form.recurrence!;
  const createsSchedule = form.mode !== "remind";
  const modeLabel = form.mode === "auto" ? "일정 자동으로 만들기" : form.mode === "schedule" ? "일정 만들지 물어보기" : "알림만 받기";
  const today = getDateKey(new Date());
  const availableProjects = projects.filter((project) => project.isActive || project.id === form.projectId);
  const availableTypes = taskTypes.filter((type) => type.isActive || type.id === form.taskTypeId);
  const missingConnections = !availableProjects.some((project) => project.id === form.projectId) || !availableTypes.some((type) => type.id === form.taskTypeId);
  function change<K extends keyof RoutineInput>(key: K, value: RoutineInput[K]) {
    setForm((previous) => ({ ...previous, [key]: value })); setDirty(true); setError("");
  }
  function changeRule<K extends keyof RoutineRecurrence>(key: K, value: RoutineRecurrence[K]) {
    change("recurrence", { ...rule, [key]: value });
  }
  function requestClose() {
    if (savingRef.current) return;
    if (dirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 닫을까요?")) return;
    onClose();
  }
  let preview: RoutineCycle[] = [];
  let previewError = "";
  let summary = "반복할 날짜를 선택해 주세요.";
  try {
    const normalized = validateRoutine({ ...form, title: form.title.trim() || "루틴", projectId: form.projectId || "preview-project", taskTypeId: form.taskTypeId || "preview-type" });
    const candidate: Routine = { ...normalized, id: routine?.id ?? "preview", createdAt: routine?.createdAt ?? "", updatedAt: routine?.updatedAt ?? "" };
    summary = routineFrequency(candidate);
    preview = getRoutinePreview(candidate, records, today, 5).filter((cycle) => cycle.dueDate && !cycle.ended);
  } catch (caught) { previewError = caught instanceof Error ? caught.message : "반복 설정을 확인해 주세요."; }
  const previewGap = preview.slice(1).reduce((smallest, cycle, index) => Math.min(smallest, (new Date(`${cycle.dueDate}T12:00:00`).getTime() - new Date(`${preview[index].dueDate}T12:00:00`).getTime()) / 86_400_000), Infinity);
  const overlappingNotice = form.leadDays > 0 && form.leadDays >= previewGap;
  const firstNoticePassed = !!preview[0] && preview[0].notifyDate < today;
  const projectName = projects.find((project) => project.id === form.projectId)?.name ?? "프로젝트 선택 필요";
  const typeName = taskTypes.find((type) => type.id === form.taskTypeId)?.name ?? "일정 종류 선택 필요";
  function adjusted(cycle: RoutineCycle) {
    if (cycle.adjusted) return true;
    if (!["monthly", "yearly"].includes(rule.frequency) || rule.monthMode !== "dates" || rule.missingDate !== "clamp") return false;
    return (cycle.sourceDates ?? [cycle.dueDate]).some((date) => {
      const day = Number(date.slice(8));
      const lastDay = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
      return day === lastDay && rule.monthDays.some((selected) => typeof selected === "number" && selected > lastDay);
    });
  }
  function preset(kind: "weekdays" | "mwf" | "weekends") {
    changeRule("weekdays", kind === "weekdays" ? [1, 2, 3, 4, 5] : kind === "mwf" ? [1, 3, 5] : [6, 7]);
  }
  return <TaskModal title={routine ? "루틴 수정" : "나의 루틴 추가"} eyebrow="MY ROUTINES" className="routine-modal" onCancel={onClose} hasUnsavedChanges={dirty} isBusy={busy}>
    <form id={formId} className="routine-editor" aria-busy={busy} onSubmit={async (event) => {
      event.preventDefault(); if (savingRef.current) return;
      savingRef.current = true; setBusy(true); setError("");
      try {
        if (missingConnections) throw new Error("프로젝트와 일정 종류를 먼저 등록하거나 선택해 주세요.");
        await saveRoutine(form, routine);
        showToast(routine ? "루틴을 수정했습니다." : form.mode === "auto" ? "루틴을 등록했습니다. 안내일에 일정을 자동으로 만듭니다." : "루틴을 등록했습니다. 때가 되면 알려드릴게요."); onClose();
      } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); }
      finally { savingRef.current = false; setBusy(false); }
    }}>
      <div className="routine-editor-scroll"><fieldset disabled={busy} className="routine-editor-layout">
        <section className="routine-editor-repeat" aria-label="반복 규칙 설정">
          <label className="routine-editor-field">어떤 일을 챙길까요?<input data-dialog-initial-focus required maxLength={200} value={form.title} onChange={(event) => change("title", event.target.value)} placeholder="예: 운동, 영수증 취합, 장비 점검" /></label>
          <fieldset className="routine-choice-fieldset"><legend>언제 반복할까요?</legend><div className="routine-frequency">
            {FREQUENCIES.map(([value, text]) => <label key={value} className="routine-choice"><input type="radio" name={`${formId}-frequency`} value={value} checked={rule.frequency === value} onChange={() => changeRule("frequency", value)} /><span>{text}</span></label>)}
          </div></fieldset>
          <label className="routine-interval">매<input type="number" required min={1} max={365} aria-label="반복 간격" value={inputNumber(rule.interval)} onChange={(event) => changeRule("interval", numberValue(event.target.value))} /><span>{FREQUENCIES.find(([value]) => value === rule.frequency)?.[2]}마다</span></label>
          {rule.frequency === "weekly" && <><SelectionGrid legend="반복할 요일" options={[1, 2, 3, 4, 5, 6, 7]} selected={rule.weekdays} label={(day) => ({ text: WEEKDAYS[day - 1], accessible: `${WEEKDAYS[day - 1]}요일` })} onChange={(days) => changeRule("weekdays", days)} />
            <div className="routine-quick"><span>빠른 선택</span><button type="button" onClick={() => preset("weekdays")}>평일</button><button type="button" onClick={() => preset("mwf")}>월·수·금</button><button type="button" onClick={() => preset("weekends")}>주말</button></div></>}
          {rule.frequency === "yearly" && <SelectionGrid legend="반복할 월" options={Array.from({ length: 12 }, (_, index) => index + 1)} selected={rule.months} label={(month) => ({ text: `${month}월`, accessible: `${month}월` })} onChange={(months) => changeRule("months", months)} className="routine-month-grid" />}
          {["monthly", "yearly"].includes(rule.frequency) && <>
            <fieldset className="routine-choice-fieldset"><legend>어떤 날에 반복할까요?</legend><div className="routine-month-mode">{[["dates", "날짜로 지정"], ["ordinal", "요일로 지정"]].map(([value, text]) => <label key={value}><input type="radio" name={`${formId}-month-mode`} checked={rule.monthMode === value} onChange={() => changeRule("monthMode", value as RoutineRecurrence["monthMode"])} />{text}</label>)}</div></fieldset>
            {rule.monthMode === "dates" ? <><SelectionGrid legend="반복할 날짜" options={DAY_CHOICES} selected={rule.monthDays} label={(day) => ({ text: day === "last" ? "말일" : String(day), accessible: day === "last" ? "매월 말일" : `매월 ${day}일` })} onChange={(days) => changeRule("monthDays", days)} />
              {rule.monthDays.some((day) => typeof day === "number" && day >= 29) && <label className="routine-editor-field">선택한 날짜가 없는 달은<select value={rule.missingDate} onChange={(event) => changeRule("missingDate", event.target.value as RoutineRecurrence["missingDate"])}><option value="clamp">그 달의 마지막 날에</option><option value="skip">그 날짜는 건너뛰기</option></select></label>}</> : <>
              <label className="routine-editor-field">몇 번째 요일인가요?<select value={rule.ordinal} onChange={(event) => changeRule("ordinal", Number(event.target.value) as RoutineRecurrence["ordinal"])}>{[1, 2, 3, 4, 5, -1].map((value) => <option key={value} value={value}>{value === -1 ? "마지막" : `${value}번째`}</option>)}</select></label>
              <SelectionGrid legend="요일 선택" options={[1, 2, 3, 4, 5, 6, 7]} selected={rule.ordinalWeekdays} label={(day) => ({ text: WEEKDAYS[day - 1], accessible: `${WEEKDAYS[day - 1]}요일` })} onChange={(days) => changeRule("ordinalWeekdays", days)} />
              {rule.ordinal === 5 && <p className="routine-editor-help">다섯 번째 요일이 없는 달은 건너뜁니다.</p>}</>}
          </>}
          <label className="routine-editor-field">언제부터 시작할까요?<input type="date" required min="2000-01-01" max="2100-12-31" value={rule.startDate} onChange={(event) => changeRule("startDate", event.target.value)} /></label>
        </section>
        <aside className="routine-rule-preview" aria-label="선택한 반복 규칙 미리보기">
          <p className="routine-preview-eyebrow">이렇게 반복해요</p><p className="routine-preview-summary" aria-live="polite">{summary}</p>
          {rule.interval > 1 && ["weekly", "yearly"].includes(rule.frequency) && <p className="routine-editor-help">{rule.startDate}을 기준으로 {rule.interval}{rule.frequency === "weekly" ? "주" : "년"}마다 반복합니다.</p>}
          <h3>다음 예정일 <span>{preview.length}회</span></h3>
          {previewError ? <p className="error-text" role="status">{previewError}</p> : preview.length === 0 ? <p className="routine-editor-help">반복이 종료되었거나 조건에 맞는 다음 예정일이 없습니다.</p> : <ol className="routine-preview-occurrences">{preview.map((cycle, index) => <li key={cycle.id}><time dateTime={cycle.dueDate}>{formatDate(cycle.dueDate)}</time>{index === 0 && <span className="routine-next-badge">다음</span>}{adjusted(cycle) && <span className="routine-adjusted-badge">날짜 조정</span>}<small>{form.mode === "auto" ? "자동 생성" : "알림"} <time dateTime={cycle.notifyDate}>{formatDate(cycle.notifyDate)}</time></small></li>)}</ol>}
          <p className="routine-preview-notify">{form.leadDays === 0 ? "당일" : `${form.leadDays}일 전`} {form.mode === "auto" ? "자동 생성" : "안내"} · {modeLabel}</p>
          {firstNoticePassed && <p className="routine-preview-warning">첫 예정일의 안내일이 지났습니다. {form.mode === "auto" ? "등록하면 안내일이 지난 미처리 회차의 일정을 바로 만듭니다." : "등록하면 바로 확인할 수 있어요."}</p>}
          {overlappingNotice && <p className="routine-preview-warning">다음 회차의 안내일이 이전 예정일보다 빠르거나 같습니다. {form.mode === "auto" ? "안내일이 된 미처리 회차의 일정을 차례로 만듭니다." : "최근 안내 대상 한 회차를 표시합니다."}</p>}
          <p className="routine-editor-help">{form.mode === "auto" ? "앱이 열려 있으면 안내일에 자동으로 만듭니다. 닫혀 있으면 다음에 열 때 만들며, 예정일이 지난 미처리 회차는 가장 최근 한 회차만 만듭니다." : "오래 접속하지 않아도 최근 안내 대상 한 회차를 챙겨드려요."}</p>
        </aside>
        <section className="routine-editor-settings" aria-label="추가 루틴 설정">
          <details className="routine-editor-details"><summary>알림과 연결 <span>{form.leadDays === 0 ? "당일" : `${form.leadDays}일 전`} · {form.mode === "auto" ? "일정 자동 생성" : form.mode === "schedule" ? "일정 제안" : "알림만"}</span></summary><div>
            <div className="routine-editor-dual"><label className="routine-editor-field">미리 알림<select aria-label="미리 알림" value={customLead ? "custom" : form.leadDays} onChange={(event) => { setCustomLead(event.target.value === "custom"); if (event.target.value !== "custom") change("leadDays", Number(event.target.value)); }}><option value="0">당일</option><option value="1">1일 전</option><option value="3">3일 전</option><option value="7">7일 전</option><option value="custom">직접 지정</option></select></label>
              <label className="routine-editor-field">안내 방식<select aria-label="안내 방식" value={form.mode} onChange={(event) => change("mode", event.target.value as RoutineInput["mode"])}><option value="schedule">일정을 만들지 물어보기</option><option value="auto">일정 자동으로 만들기</option><option value="remind">알림만 받기</option></select></label></div>
            {customLead && <label className="routine-editor-field">며칠 전에 알려드릴까요?<input type="number" required min={0} max={30} value={inputNumber(form.leadDays)} onChange={(event) => change("leadDays", numberValue(event.target.value))} /></label>}
            <p className="routine-editor-help">{form.mode === "auto" ? "미리 알림에서 선택한 안내일에, 예정일과 아래 시간으로 일정을 자동 생성합니다. 앱이 닫혀 있으면 다음에 열 때 만듭니다." : "확장 프로그램 안내는 설정을 켜면 안내일 오전 9시에 표시됩니다."}</p>
          </div></details>
          <details className="routine-editor-details" open={missingConnections || undefined}><summary>프로젝트·일정 설정 <span>{projectName}{createsSchedule ? ` · ${typeName}` : ""}</span></summary><div>
            <label className="routine-editor-field">프로젝트<select required value={form.projectId} onChange={(event) => change("projectId", event.target.value)}>{!form.projectId && <option value="">프로젝트를 선택해 주세요</option>}{availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            {createsSchedule && <div className="routine-editor-dual"><label className="routine-editor-field">일정 종류<select required value={form.taskTypeId} onChange={(event) => change("taskTypeId", event.target.value)}>{!form.taskTypeId && <option value="">일정 종류를 선택해 주세요</option>}{availableTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label><label className="routine-editor-field">생성할 일정 시간<input type="time" required value={form.time} onChange={(event) => change("time", event.target.value)} /></label></div>}
            {missingConnections && <p className="error-text" role="status">활성 프로젝트와 일정 종류가 필요합니다. 프로젝트와 설정 화면에서 먼저 등록해 주세요.</p>}
            <p className="routine-editor-help">{form.mode === "auto" ? "안내일에 이 프로젝트와 일정 종류로 예정일의 일정을 자동 생성합니다." : form.mode === "schedule" ? "안내 카드를 확인한 뒤 일정을 만듭니다." : "일정을 만들지 않고 루틴만 확인합니다."}</p>
          </div></details>
          <details className="routine-editor-details"><summary>종료·예외 설정 <span>{rule.end.type === "never" ? "계속 반복" : rule.end.type === "date" ? `${rule.end.date}까지` : `${rule.end.count}회`}{rule.excludeDates.length > 0 ? ` · 제외 ${rule.excludeDates.length}일` : ""}</span></summary><div>
            <label className="routine-editor-field">반복 종료<select aria-label="반복 종료" value={rule.end.type} onChange={(event) => changeRule("end", event.target.value === "date" ? { type: "date", date: rule.startDate } : event.target.value === "count" ? { type: "count", count: 10 } : { type: "never" })}><option value="never">계속 반복</option><option value="date">날짜 지정</option><option value="count">횟수 지정</option></select></label>
            {rule.end.type === "date" && <label className="routine-editor-field">마지막 날짜<input type="date" required min={rule.startDate || "2000-01-01"} max="2100-12-31" value={rule.end.date} onChange={(event) => changeRule("end", { type: "date", date: event.target.value })} /></label>}
            {rule.end.type === "count" && <label className="routine-editor-field">총 몇 회 반복할까요?<input type="number" required min={1} max={10000} value={inputNumber(rule.end.count)} onChange={(event) => changeRule("end", { type: "count", count: numberValue(event.target.value) })} /></label>}
            <label className="routine-editor-field">예정일이 주말이면<select value={rule.weekend} onChange={(event) => changeRule("weekend", event.target.value as RoutineRecurrence["weekend"])}><option value="none">그대로 진행</option><option value="previous">앞선 금요일로 이동</option><option value="next">다음 월요일로 이동</option></select></label>
            <div className="routine-exclude-row"><label className="routine-editor-field">제외할 날짜<input type="date" min="2000-01-01" max="2100-12-31" value={excludeDate} onChange={(event) => { setExcludeDate(event.target.value); setExcludeError(""); }} /></label><button className="btn btn-soft" type="button" onClick={() => {
              if (!isCalendarDate(excludeDate) || excludeDate < "2000-01-01" || excludeDate > "2100-12-31") { setExcludeError("제외할 날짜를 2000~2100년 사이에서 선택해 주세요."); return; }
              if (rule.excludeDates.includes(excludeDate)) { setExcludeError("이미 제외한 날짜입니다."); return; }
              if (rule.excludeDates.length >= 1000) { setExcludeError("제외 날짜는 최대 1,000개까지 추가할 수 있습니다."); return; }
              changeRule("excludeDates", [...rule.excludeDates, excludeDate].sort()); setExcludeDate(""); setExcludeError("");
            }}>제외 날짜 추가</button></div>
            {excludeError && <p className="error-text" role="alert">{excludeError}</p>}
            {rule.excludeDates.length > 0 && <ul className="routine-exclusions" aria-label="제외 날짜 목록">{rule.excludeDates.map((date) => <li key={date}><span>{date}</span><button type="button" aria-label={`${date} 제외 해제`} onClick={() => changeRule("excludeDates", rule.excludeDates.filter((item) => item !== date))}>×</button></li>)}</ul>}
            <p className="routine-editor-help">주말 이동 후 같은 날이 겹치면 한 번만 반복합니다. 제외 날짜는 이동한 날짜에 적용됩니다.</p>
          </div></details>
          <details className="routine-editor-details"><summary>함께 기억할 내용 <span>{form.content ? "메모 있음" : "선택"}</span></summary><label className="routine-editor-field">메모<textarea rows={3} maxLength={100000} value={form.content} onChange={(event) => change("content", event.target.value)} placeholder="준비할 자료나 처리 순서를 적어두세요." /></label></details>
          {routine && <p className="routine-editor-help">이미 만든 일정과 처리 이력은 그대로 유지됩니다. 변경된 규칙은 아직 처리하지 않은 회차부터 적용됩니다.</p>}
        </section>
      </fieldset></div>
      <footer className="routine-editor-actions">{error && <p className="error-text" role="alert">{error}</p>}<div><button type="button" className="btn btn-soft" disabled={busy} onClick={requestClose}>취소</button><button type="submit" className="btn btn-primary" disabled={busy || missingConnections}>{busy ? "저장 중…" : routine ? "변경사항 저장" : "루틴 등록"}</button></div></footer>
    </form>
  </TaskModal>;
}
