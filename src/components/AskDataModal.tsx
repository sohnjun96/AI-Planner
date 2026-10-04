import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { STATUS_LABELS } from "../constants";
import { isAbortError } from "../agent/agentUtils";
import { generationOptionsFromSetting } from "../agent/llmClient";
import { runQaAgent, type QaSearchRecord } from "../agent/qaAgent";
import { useAppData } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { NavLink } from "../routing";
import { formatDateTime, getDateKey } from "../utils/date";
import { GLOBAL_MEMO_KEY } from "../utils/memos";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ModalBackdrop } from "./ModalBackdrop";

interface AskDataModalProps { onClose: () => void; }
interface RecordSource { title: string; content: string; label: string; date: string; detail?: string; time?: string; href?: string; }
const PAGE_SIZE = 50;

function formatDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", ".");
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? getDateKey(parsed).replaceAll("-", ".") : "날짜 없음";
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const unique = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!unique.length) return <>{text}</>;
  const pattern = new RegExp(`(${unique.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)}</>;
}

export function AskDataModal({ onClose }: AskDataModalProps) {
  const { notes, tasks, memos, projects, projectSubcategories, taskTypes, setting } = useAppData();
  const [question, setQuestion] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [records, setRecords] = useState<QaSearchRecord[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [hasExpanded, setHasExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const noteMap = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const memoMap = useMemo(() => new Map(memos.map((memo) => [memo.id, memo])), [memos]);
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const taskTypeMap = useMemo(() => new Map(taskTypes.map((type) => [type.id, type.name])), [taskTypes]);

  function closePreview() {
    const key = selectedKey;
    setSelectedKey(null);
    window.requestAnimationFrame(() => {
      const row = key ? rowRefs.current.get(key) : undefined;
      if (row?.isConnected) row.focus();
      else inputRef.current?.focus();
    });
  }

  function handleSourceNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) onClose();
  }

  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose: selectedKey ? closePreview : onClose });
  const hasApiConfig = Boolean((setting.llmEndpoint ?? "").trim());

  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null; }, []);
  useEffect(() => {
    if (!selectedKey) return;
    previewCloseRef.current?.focus({ preventScroll: true });
    previewCloseRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey]);

  function sourceOf(record: QaSearchRecord): RecordSource | undefined {
    if (record.type === "task") {
      const task = taskMap.get(record.id);
      if (!task) return undefined;
      const start = new Date(task.startAt).getTime();
      const end = task.endAt ? new Date(task.endAt).getTime() : start;
      const startDay = formatDay(task.startAt);
      const endDay = Number.isFinite(end) && end >= start ? formatDay(task.endAt ?? task.startAt) : startDay;
      return {
        title: task.title || "제목 없는 일정", content: task.content, label: "일정",
        href: `/dashboard?${new URLSearchParams({ taskId: task.id, ...(Number.isFinite(start) ? { date: getDateKey(task.startAt) } : {}) })}`,
        date: startDay === endDay ? startDay : `${startDay}–${endDay}`,
        time: Number.isFinite(start) ? [formatDateTime(task.startAt, setting.timeFormat), Number.isFinite(end) && end > start && task.endAt ? formatDateTime(task.endAt, setting.timeFormat) : ""].filter(Boolean).join("–") : undefined,
        detail: [projectMap.get(task.projectId), taskTypeMap.get(task.taskTypeId), STATUS_LABELS[task.status]].filter(Boolean).join(" · "),
      };
    }
    if (record.type === "note") {
      const note = noteMap.get(record.id);
      if (!note) return undefined;
      return {
        title: note.title || "제목 없는 노트", content: note.content, label: "노트",
        href: `/notes?${new URLSearchParams({ noteId: note.id })}`,
        date: [record.eventDate ? `${record.eventDateSource === "linked" ? "연결 일정" : "행사"} ${formatDay(record.eventDate)}${record.eventEndDate && record.eventEndDate !== record.eventDate ? `–${formatDay(record.eventEndDate)}` : ""}` : "", `수정 ${formatDay(note.updatedAt)}`].filter(Boolean).join(" · "),
        detail: projectMap.get(note.projectId),
      };
    }
    const memo = memoMap.get(record.id);
    if (!memo) return undefined;
    return {
      title: memo.date === GLOBAL_MEMO_KEY ? "전체 메모" : `${formatDay(memo.date)} 메모`,
      content: memo.content, label: "메모",
      date: memo.date === GLOBAL_MEMO_KEY ? `수정 ${formatDay(memo.updatedAt)}` : formatDay(memo.date),
    };
  }

  const currentRecords = records.flatMap((record) => {
    const source = sourceOf(record);
    return source ? [{ record, source, key: `${record.type}:${record.id}` }] : [];
  });
  const selected = currentRecords.find((item) => item.key === selectedKey);

  async function handleAsk() {
    const q = question.trim();
    if (!q || isRunning || !hasApiConfig) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true); setProgress("검색 조건 확인 중…"); setError("");
    setRecords([]); setHasSearched(false); setVisibleCount(PAGE_SIZE); setSelectedKey(null);
    try {
      const result = await runQaAgent({
        question: q, notes, tasks, memos, projects, taskTypes, subcategories: projectSubcategories,
        endpoint: setting.llmEndpoint, apiKey: setting.llmApiKey ?? "", model: setting.llmModel,
        generationOptions: generationOptionsFromSetting(setting), signal: controller.signal,
        onProgress: (info) => { if (!controller.signal.aborted && abortRef.current === controller) setProgress(`${info.label}…`); },
      });
      if (controller.signal.aborted || abortRef.current !== controller) return;
      setRecords(result.records); setHasSearched(true);
      if (result.records.length) setHasExpanded(true);
    } catch (askError) {
      if (isAbortError(askError) || controller.signal.aborted || abortRef.current !== controller) return;
      setError(askError instanceof Error ? askError.message : "검색에 실패했습니다.");
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setIsRunning(false); setProgress(""); }
    }
  }

  function cancelSearch() {
    abortRef.current?.abort(); abortRef.current = null;
    setIsRunning(false); setProgress("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={onClose}>
      <section ref={dialogRef} className={`modal-card ask-data-modal${hasExpanded ? " is-expanded" : ""}${selectedKey ? " has-original" : ""}`} role="dialog" aria-modal="true" aria-label="기록 검색" tabIndex={-1} onClick={(event) => event.stopPropagation()}
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget || event.propertyName !== "width") return;
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && focused !== event.currentTarget && event.currentTarget.contains(focused)) focused.scrollIntoView({ block: "nearest", inline: "nearest" });
        }}>
        <header className="panel-header ask-header"><h2>질문</h2><button type="button" className="btn btn-soft" onClick={onClose}>닫기</button></header>
        {!hasApiConfig ? <p className="description-text">설정에서 AI 연결을 확인해주세요.</p> : null}
        <div className="ask-search-row">
          <input ref={inputRef} className="ask-search-input" aria-label="질문" data-dialog-initial-focus value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="일정·노트·메모를 찾아보세요" disabled={isRunning} maxLength={2000}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void handleAsk(); } }} />
          {isRunning ? <button type="button" className="btn btn-soft" onClick={cancelSearch}>중단</button> : <button type="button" className="btn btn-primary" onClick={() => void handleAsk()} disabled={!hasApiConfig || !question.trim()}>검색</button>}
        </div>
        <div className="ask-search-status" aria-live="polite" role="status">
          {isRunning ? <span className="note-ai-running"><span className="note-ai-spinner" aria-hidden="true" />{progress || "검색 중…"}</span> : null}
          {hasSearched && !isRunning ? <span>검색 결과 {currentRecords.length}건</span> : null}
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {hasSearched && !currentRecords.length ? <p className="empty-text">검색 결과가 없습니다.</p> : null}
        {currentRecords.length || selectedKey ? (
          <div className={`ask-result-layout${selectedKey ? " has-original" : ""}`}>
            <div className="ask-list-column">
              <ul className="ask-result-list" aria-label="검색된 일정과 메모">
                {currentRecords.slice(0, visibleCount).map(({ record, source, key }) => (
                  <li key={key}><button ref={(element) => { if (element) rowRefs.current.set(key, element); else rowRefs.current.delete(key); }} type="button" className="ask-result-row" data-qa-record={key} aria-expanded={selectedKey === key} aria-controls="ask-original-panel" onClick={() => setSelectedKey(key)}>
                    <span className="ask-record-meta"><span className="ask-record-type">{source.label}</span><span>{source.date}</span></span>
                    <span className="ask-record-title"><Highlight text={source.title} terms={record.terms} /></span>
                    {record.snippet ? <span className="ask-record-snippet"><Highlight text={record.snippet} terms={record.terms} /></span> : null}
                  </button>
                    {source.href ? <div className="ask-record-actions"><NavLink to={source.href} className="ask-record-open" onClick={handleSourceNavigation} aria-label={`원본 ${source.label} 열기: ${source.title}`}>{source.label} 열기<span aria-hidden="true"> ↗</span></NavLink></div> : null}
                  </li>
                ))}
              </ul>
              {currentRecords.length > visibleCount ? <button type="button" className="btn btn-soft ask-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>더 보기</button> : null}
            </div>
              <aside id="ask-original-panel" className="ask-original" aria-label="선택한 원문" hidden={!selectedKey}>
                <header className="ask-original-header"><span className="ask-record-type">{selected?.source.label ?? "원문"}</span><div className="ask-original-actions">{selected?.source.href ? <NavLink to={selected.source.href} className="btn btn-primary btn-compact" onClick={handleSourceNavigation}>{selected.source.label} 열기</NavLink> : null}<button ref={previewCloseRef} type="button" className="btn btn-soft" aria-label="원문 닫기" onClick={closePreview}>닫기</button></div></header>
                {selected ? <>
                  <h3>{selected.source.title}</h3><p className="ask-record-meta">{selected.source.date}</p>
                  {selected.source.time ? <p className="ask-record-meta">{selected.source.time}</p> : null}
                  {selected.source.detail ? <p className="ask-record-meta">{selected.source.detail}</p> : null}
                  <div className="ask-original-body">{selected.record.type === "task" ? <div className="ask-original-plain">{selected.source.content || "본문이 없습니다."}</div> : <MarkdownRenderer content={selected.source.content} checklistDisabled />}</div>
                </> : <p className="empty-text">삭제된 기록입니다.</p>}
              </aside>
          </div>
        ) : null}
      </section>
    </ModalBackdrop>
  );
}
