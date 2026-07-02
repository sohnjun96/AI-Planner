import { useEffect, useRef, useState } from "react";

interface NoteQuickAddModalProps {
  onCreate: (title: string, content: string) => Promise<void>;
  onClose: () => void;
}

export function NoteQuickAddModal({ onCreate, onClose }: NoteQuickAddModalProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit() {
    if (isSaving) {
      return;
    }
    if (!title.trim() && !content.trim()) {
      setError("제목이나 내용을 입력해 주세요.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onCreate(title, content);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "노트 생성에 실패했습니다.");
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal-card note-quick-add-card"
        role="dialog"
        aria-modal="true"
        aria-label="노트 추가"
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

        <input
          className="note-quick-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="제목 (비우면 내용에서 자동 생성)"
          aria-label="노트 제목"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              contentRef.current?.focus();
            }
          }}
        />

        <textarea
          ref={contentRef}
          className="note-quick-content"
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

        {error ? <p className="error-text">{error}</p> : null}

        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={() => void handleSubmit()} disabled={isSaving}>
            {isSaving ? "생성 중" : "노트 만들기"}
          </button>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            취소
          </button>
        </div>
      </section>
    </div>
  );
}
