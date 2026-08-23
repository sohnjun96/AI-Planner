import { useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import { NOTE_STATUS_LABELS } from "../constants";
import type { NoteFormInput } from "../models";
import { LiveMarkdownEditor } from "./LiveMarkdownEditor";
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
  onContentSelectionChange: (start: number, end: number) => void;
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
  onContentSelectionChange,
  isSaving,
  isDirty,
  savedMessage,
  errorMessage,
  initialMode = "read",
}: NoteEditorProps) {
  const [viewMode, setViewMode] = useState<"rich-text" | "source">(initialMode === "edit" ? "source" : "rich-text");

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <section className="note-editor-surface note-editor-live" onKeyDown={handleEditorKeyDown}>
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
        <div className="note-toolbar-tools">
          <div className="note-mode-toggle" role="group" aria-label="노트 보기 방식">
            <button
              type="button"
              className={viewMode === "rich-text" ? "active" : undefined}
              aria-pressed={viewMode === "rich-text"}
              onClick={() => setViewMode("rich-text")}
            >
              라이브
            </button>
            <button
              type="button"
              className={viewMode === "source" ? "active" : undefined}
              aria-pressed={viewMode === "source"}
              onClick={() => setViewMode("source")}
            >
              원문
            </button>
          </div>
        </div>
      </div>

      {overlay ? (
        <div className="note-editor-overlay-panel">
          <NoteInlineDiff
            previous={overlay.previous}
            next={overlay.next}
            headline={overlay.headline}
            mode={overlay.mode}
            isApplying={overlay.isApplying}
            onAccept={onAcceptOverlay}
            onReject={onRejectOverlay}
          />
        </div>
      ) : null}

      <div className="note-read-view" onContextMenu={onContentContextMenu}>
        <LiveMarkdownEditor
          content={draft.content}
          onChange={onChangeContent}
          onSelectionChange={onContentSelectionChange}
          placeholder="내용을 입력하세요."
          initialMode={initialMode}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      </div>

      {savedMessage || errorMessage ? (
        <div className="note-editor-status">
          {savedMessage ? <span className="success-text">{savedMessage}</span> : null}
          {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
        </div>
      ) : null}
    </section>
  );
}
