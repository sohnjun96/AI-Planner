import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type RefObject } from "react";
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

const MAX_NOTE_UNDO_STEPS = 50;
const MAX_NOTE_UNDO_CHARACTERS = 2_000_000;

function appendHistorySnapshot(stack: string[], value: string): string[] {
  if (stack[stack.length - 1] === value) return stack;
  const next = [...stack, value];
  let totalCharacters = next.reduce((sum, item) => sum + item.length, 0);
  while (next.length > 1 && (next.length > MAX_NOTE_UNDO_STEPS || totalCharacters > MAX_NOTE_UNDO_CHARACTERS)) {
    totalCharacters -= next.shift()?.length ?? 0;
  }
  return next;
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
  const contentRef = useRef(draft.content);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const lastEditRef = useRef<{ at: number; kind: "typing" | "structural" } | null>(null);

  useEffect(() => {
    if (draft.content === contentRef.current) return;
    contentRef.current = draft.content;
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastEditRef.current = null;
  }, [draft.content]);

  function handleContentChange(nextContent: string) {
    const currentContent = contentRef.current;
    if (nextContent === currentContent) return;
    const now = Date.now();
    const kind = Math.abs(nextContent.length - currentContent.length) === 1 ? "typing" : "structural";
    const mergeTyping = kind === "typing" && lastEditRef.current?.kind === "typing" && now - lastEditRef.current.at < 750;
    if (!mergeTyping) undoStackRef.current = appendHistorySnapshot(undoStackRef.current, currentContent);
    redoStackRef.current = [];
    lastEditRef.current = { at: now, kind };
    contentRef.current = nextContent;
    onChangeContent(nextContent);
  }

  function undoContentChange() {
    const previous = undoStackRef.current.pop();
    if (previous === undefined) return;
    redoStackRef.current = appendHistorySnapshot(redoStackRef.current, contentRef.current);
    contentRef.current = previous;
    lastEditRef.current = null;
    onChangeContent(previous);
  }

  function redoContentChange() {
    const next = redoStackRef.current.pop();
    if (next === undefined) return;
    undoStackRef.current = appendHistorySnapshot(undoStackRef.current, contentRef.current);
    contentRef.current = next;
    lastEditRef.current = null;
    onChangeContent(next);
  }

  function handleEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
      return;
    }
    if (event.key.toLowerCase() !== "z") return;
    const target = event.target;
    const isContentEditor =
      target instanceof HTMLElement &&
      (target.classList.contains("markdown-source-input") || target.classList.contains("live-markdown-surface"));
    if (!isContentEditor) return;
    event.preventDefault();
    if (event.shiftKey) redoContentChange();
    else undoContentChange();
  }

  return (
    <section className={`note-editor-surface note-editor-${mode}`} ref={containerRef} onKeyDown={handleEditorKeyDown}>
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
          onChange={handleContentChange}
          textareaRef={textareaRef}
          onContextMenu={onContentContextMenu}
          placeholder="내용을 입력하세요."
          rows={18}
        />
      ) : (
        <div className="note-read-view" onContextMenu={onContentContextMenu}>
          <LiveMarkdownEditor
            content={draft.content}
            onChange={handleContentChange}
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
