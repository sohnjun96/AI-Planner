import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { NOTE_STATUS_LABELS } from "../constants";
import type { NoteAiAction, NoteFormInput } from "../models";
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
  aiActions: NoteAiAction[];
  aiEnabled: boolean;
  isAiRunning: boolean;
  overlay?: NoteEditorOverlay | null;
  onAcceptOverlay: () => void;
  onRejectOverlay: () => void;
  onRunAiAction: (prompt: string) => void;
  onInlineAssist: () => void;
  onCustomAi: () => void;
  onExtractActions: () => void;
  onManageAi: () => void;
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
  aiActions,
  aiEnabled,
  isAiRunning,
  overlay,
  onAcceptOverlay,
  onRejectOverlay,
  onRunAiAction,
  onInlineAssist,
  onCustomAi,
  onExtractActions,
  onManageAi,
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

      <div className="note-meta-bar">
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
      </div>

      <div className="note-ai-bar">
        <span className="note-ai-bar-label">AI</span>
        {aiActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="note-ai-chip"
            title={action.prompt}
            disabled={!aiEnabled || isAiRunning}
            onClick={() => onRunAiAction(action.prompt)}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          className="note-ai-chip subtle"
          disabled={!aiEnabled || isAiRunning}
          onClick={onInlineAssist}
          title="선택한 텍스트만 편집"
        >
          선택 편집
        </button>
        <button
          type="button"
          className="note-ai-chip subtle"
          disabled={!aiEnabled || isAiRunning}
          onClick={onCustomAi}
          title="원하는 편집을 직접 입력"
        >
          직접 요청
        </button>
        <button
          type="button"
          className="note-ai-chip action"
          disabled={!aiEnabled || isAiRunning}
          onClick={onExtractActions}
          title="노트에서 할 일을 뽑아 일정으로 만들기"
        >
          📅 일정 추출
        </button>
        <button type="button" className="note-ai-manage" onClick={onManageAi} title="AI 편집 기능 관리">
          관리
        </button>
        {isAiRunning ? <span className="note-ai-bar-status">처리 중…</span> : null}
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

      <footer className="note-editor-footer">
        <div className="note-editor-footer-left">
          <button type="button" className="note-text-button" onClick={onOpenHistory}>
            이력 {historyCount > 0 ? `(${historyCount})` : ""}
          </button>
          {savedMessage ? <span className="success-text">{savedMessage}</span> : null}
          {errorMessage ? <span className="error-text">{errorMessage}</span> : null}
        </div>
        <button type="button" className="note-text-button danger" onClick={onDelete}>
          삭제
        </button>
      </footer>
    </section>
  );
}
