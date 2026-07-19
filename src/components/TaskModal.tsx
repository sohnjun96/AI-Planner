import { useId, type ReactNode } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus";

interface TaskModalProps {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  hasUnsavedChanges?: boolean;
  isBusy?: boolean;
}

export function TaskModal({ title, onCancel, children, hasUnsavedChanges = false, isBusy = false }: TaskModalProps) {
  const titleId = useId();

  function requestClose() {
    const activeForm = document.querySelector<HTMLFormElement>(".task-modal-card .task-form");
    const formIsBusy = activeForm?.getAttribute("aria-busy") === "true";
    const formIsDirty = activeForm?.dataset.taskFormDirty === "true";
    if (isBusy || formIsBusy) {
      return;
    }
    if ((hasUnsavedChanges || formIsDirty) && !window.confirm("저장하지 않은 변경사항이 있습니다. 닫을까요?")) {
      return;
    }
    onCancel();
  }

  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose: requestClose });

  return (
    <div
      className="modal-backdrop task-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="modal-card panel task-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="panel-header task-modal-header">
          <div>
            <p className="eyebrow">SCHEDULE</p>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="btn btn-soft task-modal-close"
            onClick={requestClose}
            disabled={isBusy}
            aria-label={`${title} 창 닫기`}
          >
            {isBusy ? "저장 중…" : "닫기"}
          </button>
        </header>
        <div className="task-modal-body">{children}</div>
      </section>
    </div>
  );
}
