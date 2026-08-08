import { useState } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";

interface NoteQuickAddModalProps {
  onCreate: (content: string) => Promise<void>;
  onClose: () => void;
}

export function NoteQuickAddModal({ onCreate, onClose }: NoteQuickAddModalProps) {
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose });

  async function handleSubmit() {
    if (isSaving) {
      return;
    }
    if (!content.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onCreate(content);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "노트 생성에 실패했습니다.");
      setIsSaving(false);
    }
  }

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={onClose}>
      <section
        ref={dialogRef}
        className="modal-card note-quick-add-card"
        role="dialog"
        aria-modal="true"
        aria-label="노트 추가"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <div>
            <p className="eyebrow">NEW NOTE</p>
            <h2>노트 추가</h2>
          </div>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            닫기
          </button>
        </header>

        <textarea
          className="note-quick-content"
          data-dialog-initial-focus
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="내용을 입력하세요. 마크다운을 지원합니다. (Ctrl+Enter로 저장)"
          rows={8}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void handleSubmit();
            }
          }}
        />

        {error ? <p className="error-text" role="alert">{error}</p> : null}

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={isSaving}>
            {isSaving ? "생성 중" : "노트 만들기"}
          </button>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            취소
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
