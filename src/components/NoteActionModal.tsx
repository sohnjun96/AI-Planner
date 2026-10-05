import { useId, useMemo, useState } from "react";
import type { NoteActionItem } from "../agent/notesAgent";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";
import { defaultNoteActionWhen, validateNoteAction } from "../utils/noteActionValidation";

export interface ConfirmedAction {
  title: string;
  content?: string;
  startAtIso: string;
}

interface NoteActionModalProps {
  items: NoteActionItem[];
  isBusy: boolean;
  errorMessage?: string;
  onConfirm: (actions: ConfirmedAction[]) => void;
  onClose: () => void;
}

interface Row {
  title: string;
  content?: string;
  checked: boolean;
  when: string; // datetime-local value
}

export function NoteActionModal({ items, isBusy, errorMessage, onConfirm, onClose }: NoteActionModalProps) {
  const initialRows = useMemo<Row[]>(
    () => items.map((item) => ({ title: item.title, content: item.content, checked: true, when: defaultNoteActionWhen(item.startAt) })),
    [items],
  );
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [showValidation, setShowValidation] = useState(false);
  const fieldId = useId();
  const validations = rows.map((row) => validateNoteAction(row.title, row.when));
  const requestClose = () => { if (!isBusy) onClose(); };
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose: requestClose });

  function update(index: number, patch: Partial<Row>) {
    if (isBusy) return;
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function handleConfirm() {
    if (isBusy) return;
    setShowValidation(true);
    if (rows.some((row, index) => row.checked && (validations[index].titleError || validations[index].whenError))) return;
    const actions: ConfirmedAction[] = rows
      .flatMap((row, index) => row.checked && validations[index].startAtIso ? [{
        title: row.title.trim(),
        content: row.content,
        startAtIso: validations[index].startAtIso!,
      }] : []);
    if (actions.length > 0) {
      onConfirm(actions);
    }
  }

  const selectedCount = rows.filter((row) => row.checked).length;

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={requestClose}>
      <section
        ref={dialogRef}
        className="modal-card note-action-modal"
        role="dialog"
        aria-modal="true"
        aria-label="추출한 액션 아이템"
        aria-busy={isBusy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <div>
            <p className="eyebrow">ACTION ITEMS</p>
            <h2>일정으로 만들 항목</h2>
            <small>노트에서 뽑은 할 일이에요. 시간을 확인하고 일정으로 등록하세요.</small>
          </div>
          <button type="button" className="btn btn-soft" onClick={requestClose} disabled={isBusy}>
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
                  disabled={isBusy}
                  onChange={(event) => update(index, { checked: event.target.checked })}
                  aria-label={`${row.title} 선택`}
                />
                <div className="action-item-fields">
                  <input
                    className="action-item-title"
                    value={row.title}
                    onChange={(event) => update(index, { title: event.target.value })}
                    placeholder="할 일"
                    aria-label={`일정 ${index + 1} 제목`}
                    aria-invalid={showValidation && row.checked && Boolean(validations[index].titleError)}
                    aria-describedby={showValidation && row.checked && validations[index].titleError ? `${fieldId}-title-${index}` : undefined}
                    disabled={isBusy}
                    maxLength={500}
                  />
                  {showValidation && row.checked && validations[index].titleError ? <p id={`${fieldId}-title-${index}`} className="error-text" role="alert">{validations[index].titleError}</p> : null}
                  <input
                    className="action-item-when"
                    type="datetime-local"
                    value={row.when}
                    onChange={(event) => update(index, { when: event.target.value })}
                    aria-label="일정 시간"
                    aria-invalid={showValidation && row.checked && Boolean(validations[index].whenError)}
                    aria-describedby={showValidation && row.checked && validations[index].whenError ? `${fieldId}-when-${index}` : undefined}
                    disabled={isBusy}
                  />
                  {showValidation && row.checked && validations[index].whenError ? <p id={`${fieldId}-when-${index}`} className="error-text" role="alert">{validations[index].whenError}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {errorMessage ? <p className="error-text" role="alert">{errorMessage}</p> : null}
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={isBusy || selectedCount === 0}>
            {isBusy ? "생성 중…" : `선택 ${selectedCount}건 일정 생성`}
          </button>
          <button type="button" className="btn btn-soft" onClick={requestClose} disabled={isBusy}>
            취소
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
