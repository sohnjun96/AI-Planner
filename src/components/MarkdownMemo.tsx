import { useEffect, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MarkdownMemoProps {
  content: string;
  savedMessage?: string;
  errorMessage?: string;
  onSave: (content: string) => Promise<void>;
  onEditStart?: () => void;
}

export function MarkdownMemo({ content, savedMessage, errorMessage, onSave, onEditStart }: MarkdownMemoProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState(content);

  useEffect(() => {
    if (!isEditing) {
      setDraft(content);
    }
  }, [content, isEditing]);

  async function handleSave() {
    setIsSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
      setIsPreviewing(false);
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <section className="panel global-memo-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">GLOBAL MEMO</p>
            <h2>전체 메모</h2>
            <small>마크다운으로 작성한 내용을 읽기 좋은 형태로 보여줍니다.</small>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onEditStart?.();
              setDraft(content);
              setIsEditing(true);
            }}
          >
            메모 수정
          </button>
        </header>
        <MarkdownRenderer content={content} emptyText="아직 전체 메모가 없습니다. 수정 버튼을 눌러 작성하세요." />
        {savedMessage ? <p className="success-text">{savedMessage}</p> : null}
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
      </section>
    );
  }

  return (
    <section className="panel global-memo-panel editing">
      <header className="panel-header">
        <div>
          <p className="eyebrow">GLOBAL MEMO</p>
          <h2>전체 메모 수정</h2>
          <small>저장 전 미리보기로 마크다운 결과를 확인할 수 있습니다.</small>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-soft" onClick={() => setIsPreviewing((prev) => !prev)}>
            {isPreviewing ? "원문 보기" : "미리보기"}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setDraft(content);
              setIsEditing(false);
              setIsPreviewing(false);
            }}
          >
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? "저장 중" : "저장"}
          </button>
        </div>
      </header>

      {isPreviewing ? (
        <MarkdownRenderer content={draft} emptyText="미리볼 내용이 없습니다." />
      ) : (
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={8}
          placeholder={"# 전체 메모\n- [ ] 확인할 일\n- 중요한 링크나 운영 메모를 적어두세요."}
        />
      )}

      {savedMessage ? <p className="success-text">{savedMessage}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}
