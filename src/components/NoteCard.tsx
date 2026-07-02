import { type CSSProperties, type MouseEvent } from "react";
import { NOTE_STATUS_LABELS } from "../constants";
import type { Note, Project } from "../models";

interface NoteCardProps {
  note: Note;
  project?: Project;
  isSelected: boolean;
  isChecked: boolean;
  linkedTaskCount: number;
  onSelect: () => void;
  onToggleCheck: (checked: boolean) => void;
}

function toSnippet(content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_\-[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 90);
}

export function NoteCard({ note, project, isSelected, isChecked, linkedTaskCount, onSelect, onToggleCheck }: NoteCardProps) {
  const snippet = toSnippet(note.content);

  function handleCheckClick(event: MouseEvent<HTMLInputElement>) {
    event.stopPropagation();
  }

  return (
    <article
      className={`note-card ${isSelected ? "selected" : ""} ${note.isPinned ? "pinned" : ""}`}
      style={{ "--note-project-color": project?.color ?? "var(--body-muted)" } as CSSProperties}
      onClick={onSelect}
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
          onChange={(event) => onToggleCheck(event.target.checked)}
          aria-label={`${note.title} 선택`}
        />
        <h3 className="note-card-title">
          {note.isPinned ? <span aria-label="고정됨">📌 </span> : null}
          {note.title}
        </h3>
        <span className={`note-status-badge status-${note.status}`}>{NOTE_STATUS_LABELS[note.status]}</span>
      </div>

      {snippet ? <p className="note-card-snippet">{snippet}</p> : null}

      <div className="note-card-footer">
        {project ? <span className="note-card-project">{project.name}</span> : null}
        {note.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="note-card-tag">
            #{tag}
          </span>
        ))}
        {linkedTaskCount > 0 ? <span className="note-card-links">🔗 {linkedTaskCount}</span> : null}
      </div>
    </article>
  );
}
