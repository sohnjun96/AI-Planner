import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { NOTE_STATUS_LABELS } from "../constants";
import type { NoteFormInput } from "../models";
import { MarkdownRenderer } from "./MarkdownRenderer";
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
  onToggleChecklist: (lineIndex: number, checked: boolean) => void;
  onSave: () => void;
  onOpenMeta: () => void;
  onOpenHistory: () => void;
  onDelete: () => void;
  onContentContextMenu: (event: MouseEvent<HTMLElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isSaving: boolean;
  isDirty: boolean;
  savedMessage?: string;
  errorMessage?: string;
  historyCount: number;
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
  onToggleChecklist,
  onSave,
  onOpenMeta,
  onOpenHistory,
  onDelete,
  onContentContextMenu,
  textareaRef,
  isSaving,
  isDirty,
  savedMessage,
  errorMessage,
  historyCount,
}: NoteEditorProps) {
  const [mode, setMode] = useState<"edit" | "read">("read");
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
    <section className="note-editor-surface" ref={containerRef}>
      <header className="note-editor-bar">
        <input
          className="note-title-input"
          value={draft.title}
          onChange={(event) => onChangeTitle(event.target.value)}
          placeholder="제목 없음"
          aria-label="노트 제목"
        />
        <div className="note-editor-bar-actions">
          <div className="note-mode-toggle" role="group" aria-label="보기 모드">
            <button
              type="button"
              className={mode === "edit" ? "active" : ""}
              aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}
            >
              편집
            </button>
            <button
              type="button"
              className={mode === "read" ? "active" : ""}
              aria-pressed={mode === "read"}
              onClick={() => setMode("read")}
            >
              읽기
            </button>
          </div>
          <button type="button" className="btn btn-primary" disabled={isSaving || !isDirty} onClick={onSave} title="Ctrl+S">
            {isSaving ? "저장 중" : isDirty ? "저장" : "저장됨"}
          </button>
        </div>
      </header>

      {/* 분류 칩(왼쪽) + 도구(오른쪽)를 한 줄로 — 편집기 상단을 차분하게 유지 */}
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
          <span className="note-meta-edit-hint">수정</span>
        </button>

        <div className="note-toolbar-tools">
          {isAiRunning ? <span className="note-ai-bar-status">AI 처리 중…</span> : null}
          <button
            type="button"
            className="note-ai-button"
            disabled={!aiEnabled || isAiRunning}
            onClick={onOpenAiMenu}
            title="AI 편집 메뉴 (본문 우클릭과 동일)"
          >
            ✨ AI
          </button>
          <button type="button" className="note-text-button" onClick={onOpenHistory}>
            이력 {historyCount > 0 ? `(${historyCount})` : ""}
          </button>
          <button type="button" className="note-text-button danger" onClick={onDelete}>
            삭제
          </button>
        </div>
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
        <textarea
          ref={textareaRef}
          className="note-content-textarea"
          value={draft.content}
          onChange={(event) => onChangeContent(event.target.value)}
          onContextMenu={onContentContextMenu}
          placeholder={"내용을 입력하세요. 우클릭하면 AI 편집 메뉴가 열립니다."}
          rows={18}
        />
      ) : (
        <div
          className="note-read-view"
          onContextMenu={onContentContextMenu}
          onDoubleClick={() => setMode("edit")}
          title="더블클릭하면 편집 모드로 전환됩니다"
        >
          <button type="button" className="note-read-edit-fab" onClick={() => setMode("edit")} title="편집 (더블클릭)">
            ✎ 편집
          </button>
          <MarkdownRenderer
            content={draft.content}
            emptyText="작성된 내용이 없습니다. 더블클릭하거나 ‘편집’을 눌러 작성하세요."
            onChecklistToggle={onToggleChecklist}
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
