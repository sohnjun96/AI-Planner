import { useMemo, useState } from "react";
import type { NoteActionItem } from "../agent/notesAgent";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";

export interface ConfirmedAction {
  title: string;
  content?: string;
  startAtIso: string;
}

interface NoteActionModalProps {
  items: NoteActionItem[];
  isBusy: boolean;
  onConfirm: (actions: ConfirmedAction[]) => void;
  onClose: () => void;
}

interface Row {
  title: string;
  content?: string;
  checked: boolean;
  when: string; // datetime-local value
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultWhen(startAt?: string): string {
  if (startAt) {
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(startAt) ? `${startAt}T09:00` : startAt);
    if (!Number.isNaN(parsed.getTime())) {
      return toLocalInput(parsed);
    }
  }
  const fallback = new Date();
  fallback.setHours(9, 0, 0, 0);
  return toLocalInput(fallback);
}

export function NoteActionModal({ items, isBusy, onConfirm, onClose }: NoteActionModalProps) {
  const initialRows = useMemo<Row[]>(
    () => items.map((item) => ({ title: item.title, content: item.content, checked: true, when: defaultWhen(item.startAt) })),
    [items],
  );
  const [rows, setRows] = useState<Row[]>(initialRows);
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose });

  function update(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleConfirm() {
    const actions: ConfirmedAction[] = rows
      .filter((row) => row.checked && row.title.trim())
      .map((row) => ({
        title: row.title.trim(),
        content: row.content,
        startAtIso: new Date(row.when).toISOString(),
      }));
    if (actions.length > 0) {
      onConfirm(actions);
    }
  }

  const selectedCount = rows.filter((row) => row.checked).length;

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={onClose}>
      <section
        ref={dialogRef}
        className="modal-card note-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label="추출한 액션 아이템"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <div>
            <p className="eyebrow">ACTION ITEMS</p>
            <h2>일정으로 만들 항목</h2>
            <small>노트에서 뽑은 할 일이에요. 시간을 확인하고 일정으로 등록하세요.</small>
          </div>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            닫기
          </button>
        </header>

        {rows.length === 0 ? (
          <p className="empty-text">추출된 액션 아이템이 없습니다.</p>
        ) : (
          <ul className="action-item-list">
            {rows.map((row, index) => (
              <li key={index} className={`action-item ${row.checked ? "checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={(event) => update(index, { checked: event.target.checked })}
                  aria-label={`${row.title} 선택`}
                />
                <div className="action-item-fields">
                  <input
                    className="action-item-title"
                    value={row.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                    placeholder="할 일"
                  />
                  <input
                    className="action-item-when"
                    type="datetime-local"
                    value={row.when}
                    onChange={(event) => update(index, { when: event.target.value })}
                    aria-label="일정 시간"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={isBusy || selectedCount === 0}>
            {isBusy ? "생성 중…" : `선택 ${selectedCount}건 일정 생성`}
          </button>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            취소
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
