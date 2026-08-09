import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { NOTE_STATUS_LABELS } from "../constants";
import type { NoteFormInput } from "../models";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";
import { MarkdownComposer } from "./MarkdownComposer";
import { NoteInlineDiff } from "./NoteInlineDiff";

export interface NoteEditorOverlay {
  previous: string;
  next: string;
  headline?: string;
  mode: "proposal" | "compare";
  isApplying?: boolean;
}

interface NoteEditorProps {
  draft: NoteFormInput;
  projectName: string;
  projectColor: string;
  subcategoryName?: string;
  aiEnabled: boolean;
  isAiRunning: boolean;
  overlay?: NoteEditorOverlay | null;
  onAcceptOverlay: () => void;
  onRejectOverlay: () => void;
  /** ✨AI 버튼 — 우클릭과 동일한 AI 메뉴를 버튼 위치에 연다 */
  onOpenAiMenu: (event: MouseEvent<HTMLElement>) => void;
  onChangeTitle: (value: string) => void;
  onChangeContent: (value: string) => void;
  onSave: () => void;
  onOpenMeta: () => void;
  onOpenMoreMenu: (event: MouseEvent<HTMLElement>) => void;
  onContentContextMenu: (event: MouseEvent<HTMLElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isSaving: boolean;
  isDirty: boolean;
  savedMessage?: string;
  errorMessage?: string;
  initialMode?: "edit" | "read";
}

export function NoteEditor({
  draft,
  projectName,
  projectColor,
  subcategoryName,
  aiEnabled,
  isAiRunning,
  overlay,
  onAcceptOverlay,
  onRejectOverlay,
  onOpenAiMenu,
  onChangeTitle,
  onChangeContent,
  onSave,
  onOpenMeta,
  onOpenMoreMenu,
  onContentContextMenu,
  textareaRef,
  isSaving,
  isDirty,
  savedMessage,
  errorMessage,
  initialMode = "read",
}: NoteEditorProps) {
  const [mode, setMode] = useState<"edit" | "read">(initialMode);
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        if (containerRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          onSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSave]);

  return (
    <section className={`note-editor-surface note-editor-${mode}`} ref={containerRef}>
      <header className="note-editor-bar">
        <input
          className="note-title-input"
          value={draft.title}
          onChange={(event) => onChangeTitle(event.target.value)}
          placeholder="제목 없음"
          aria-label="노트 제목"
        />
        <div className="note-editor-bar-actions">
          {isDirty && !isSaving ? (
            <button type="button" className="note-save-action" onClick={onSave} title="지금 저장 (Ctrl+S)">
              저장
            </button>
          ) : (
            <span className="note-save-status" aria-live="polite">
              {isSaving ? "저장 중…" : "✓ 저장됨"}
            </span>
          )}
          <div className="note-mode-toggle" role="group" aria-label="편집 방식">
            <button
              type="button"
              className={mode === "edit" ? "active" : ""}
              aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}
            >
              원문
            </button>
            <button
              type="button"
              className={mode === "read" ? "active" : ""}
              aria-pressed={mode === "read"}
              onClick={() => setMode("read")}
            >
              라이브
            </button>
          </div>
          <button
            type="button"
            className="note-ai-button"
            disabled={!aiEnabled || isAiRunning}
            onClick={onOpenAiMenu}
            aria-label="AI 편집"
          >
            {isAiRunning ? "AI 처리 중…" : "AI"}
          </button>
          <button type="button" className="note-more-button" onClick={onOpenMoreMenu} aria-label="노트 더보기" title="더보기">
            ⋯
          </button>
        </div>
      </header>

      {/* 분류 정보는 제목 바로 아래에 두고, 보조 작업은 더보기 메뉴로 모은다. */}
      <div className="note-toolbar">
        <button type="button" className="note-meta-chips" onClick={onOpenMeta} aria-label="분류 및 태그 수정">
          <span className="note-meta-chip project" style={{ "--note-project-color": projectColor } as React.CSSProperties}>
            {projectName}
          </span>
          {subcategoryName ? <span className="note-meta-chip">{subcategoryName}</span> : null}
          <span className={`note-meta-chip status status-${draft.status}`}>{NOTE_STATUS_LABELS[draft.status]}</span>
          {draft.isPinned ? <span className="note-meta-chip pin">📌 고정</span> : null}
          {draft.tags.map((tag) => (
            <span key={tag} className="note-meta-chip tag">
              #{tag}
            </span>
          ))}
        </button>
      </div>

      {overlay ? (
        <NoteInlineDiff
          previous={overlay.previous}
          next={overlay.next}
          headline={overlay.headline}
          mode={overlay.mode}
          isApplying={overlay.isApplying}
          onAccept={onAcceptOverlay}
          onReject={onRejectOverlay}
        />
      ) : mode === "edit" ? (
        <MarkdownComposer
          value={draft.content}
          onChange={onChangeContent}
          textareaRef={textareaRef}
          onContextMenu={onContentContextMenu}
          placeholder="내용을 입력하세요."
          rows={18}
        />
      ) : (
        <div className="note-read-view" onContextMenu={onContentContextMenu}>
          <LiveMarkdownEditor
            content={draft.content}
            onChange={onChangeContent}
            placeholder="내용을 입력하세요."
          />
        </div>
      )}

      {savedMessage || errorMessage ? (
        <div className="note-editor-status">
          {savedMessage ? <span className="success-text">{savedMessage}</span> : null}
          {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
