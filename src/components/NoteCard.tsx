import { type CSSProperties, type DragEvent, type MouseEvent } from "react";
import type { Note, Project } from "../models";

interface NoteCardProps {
  note: Note;
  project?: Project;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: () => void;
  onOpenForEdit: () => void;
  onToggleCheck: (checked: boolean) => void;
  onOpenMenu: (position: { x: number; y: number }) => void;
  onOpenAiMenu: (position: { x: number; y: number }) => void;
  /** 탐색기 목록에서 위아래 순서 변경용 드래그 지원 (선택적) */
  draggable?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLElement>) => void;
}

export function NoteCard({
  note,
  project,
  isSelected,
  isChecked,
  onSelect,
  onOpenForEdit,
  onToggleCheck,
  onOpenMenu,
  onOpenAiMenu,
  draggable,
  dragging,
  dragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: NoteCardProps) {
  function handleCheckClick(event: MouseEvent<HTMLInputElement>) {
    event.stopPropagation();
  }

  function handleCheckDoubleClick(event: MouseEvent<HTMLInputElement>) {
    event.stopPropagation();
  }

  function handleKebabClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onOpenMenu({ x: rect.right, y: rect.bottom });
  }

  function handleKebabDoubleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
  }

  return (
    <article
      className={`note-card ${isSelected ? "selected" : ""} ${note.isPinned ? "pinned" : ""} ${dragging ? "dragging" : ""} ${
        dragOver ? "drag-over" : ""
      }`}
      style={{ "--note-project-color": project?.color ?? "var(--body-muted)" } as CSSProperties}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onDoubleClick={onOpenForEdit}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenAiMenu({ x: event.clientX, y: event.clientY });
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="note-card-top">
        <input
          type="checkbox"
          className="note-card-check"
          checked={isChecked}
          onClick={handleCheckClick}
          onDoubleClick={handleCheckDoubleClick}
          onChange={(event) => onToggleCheck(event.target.checked)}
          aria-label={`${note.title} 선택`}
        />
        <h3 className="note-card-title">
          {note.isPinned ? <span aria-label="고정됨">📌 </span> : null}
          {note.title}
        </h3>
        <button
          type="button"
          className="note-card-kebab"
          aria-label={`${note.title} 메뉴`}
          title="메뉴"
          onClick={handleKebabClick}
          onDoubleClick={handleKebabDoubleClick}
        >
          ⋯
        </button>
      </div>

    </article>
  );
}
