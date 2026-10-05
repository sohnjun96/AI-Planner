import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { Task } from "../models";
import { formatDateTime } from "../utils/date";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";

interface Props {
  tasks: Task[];
  excludedIds: string[];
  timeFormat: "24h" | "12h";
  onLink: (taskId: string) => Promise<void>;
  onClose: () => void;
}

export function NoteTaskLinkModal({ tasks, excludedIds, timeFormat, onLink, onClose }: Props) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [limit, setLimit] = useState(50);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const close = () => { if (!busyRef.current) onClose(); };
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose: close });
  const matches = useMemo(() => {
    const excluded = new Set(excludedIds);
    const keyword = deferredSearch.trim().toLowerCase();
    return tasks.filter((task) => !excluded.has(task.id) && `${task.title} ${task.content}`.toLowerCase().includes(keyword))
      .sort((a, b) => b.startAt.localeCompare(a.startAt));
  }, [tasks, excludedIds, deferredSearch]);
  async function link(id: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setError("");
    try { await onLink(id); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "일정을 연결하지 못했습니다."); }
    finally { busyRef.current = false; setIsBusy(false); }
  }
  return <ModalBackdrop className="modal-backdrop" onRequestClose={close}>
    <section ref={dialogRef} className="modal-card note-task-link-modal" role="dialog" aria-modal="true" aria-label="노트에 일정 연결" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <header className="panel-header"><h2>일정 찾아 연결</h2><button type="button" className="btn btn-soft" disabled={isBusy} onClick={close}>닫기</button></header>
      <label className="note-modal-field">일정 검색<input value={search} disabled={isBusy} onChange={(event) => { setSearch(event.target.value); setLimit(50); }} placeholder="제목이나 내용으로 검색" /></label>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <div className="note-task-link-list">{matches.length ? matches.slice(0, limit).map((task) => <button type="button" className="note-task-link-choice" key={task.id} disabled={isBusy} onClick={() => void link(task.id)}><strong>{task.title}</strong><small>{formatDateTime(task.startAt, timeFormat)}</small></button>) : <p className="empty-text">연결할 일정이 없습니다. 검색어를 바꿔 보세요.</p>}</div>
      {matches.length > limit ? <button type="button" className="btn btn-soft" disabled={isBusy} onClick={() => setLimit((value) => value + 50)}>더 보기 ({matches.length - limit}개)</button> : null}
      {isBusy ? <p role="status">일정을 연결하고 있습니다…</p> : null}
    </section>
  </ModalBackdrop>;
}
