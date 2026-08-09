import { STATUS_LABELS } from "../constants";
import type { Note, Task } from "../models";
import { formatDateTime } from "../utils/date";

interface SuggestedTask {
  task: Task;
  reason: string;
}

interface RelatedNote {
  note: Note;
  reason: string;
  isOriginal?: boolean;
}

interface NoteConnectionsProps {
  linkedTasks: Task[];
  suggestions: SuggestedTask[];
  relatedNotes: RelatedNote[];
  timeFormat: "24h" | "12h";
  onOpenTask: (taskId: string) => void;
  onOpenNote: (noteId: string) => void;
  onLink: (taskId: string) => void;
  onUnlink: (taskId: string) => void;
  isBusy?: boolean;
}

export function NoteConnections({
  linkedTasks,
  suggestions,
  relatedNotes,
  timeFormat,
  onOpenTask,
  onOpenNote,
  onLink,
  onUnlink,
  isBusy,
}: NoteConnectionsProps) {
  return (
    <section className="note-connections" aria-label="노트 관련 정보">
      <div className="note-connection-group">
        <span className="note-connection-label">관련 일정</span>
        <div className="note-connection-chips">
          {linkedTasks.length > 0
            ? linkedTasks.map((task) => (
                <span key={task.id} className="note-connection-chip linked">
                  <button type="button" className="note-connection-open" onClick={() => onOpenTask(task.id)} title="일정으로 이동">
                    {task.title}
                    <small>
                      {formatDateTime(task.startAt, timeFormat)} · {STATUS_LABELS[task.status]}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="note-connection-remove"
                    aria-label="연결 해제"
                    onClick={() => onUnlink(task.id)}
                    disabled={isBusy}
                  >
                    ×
                  </button>
                </span>
              ))
            : null}
          {suggestions.length > 0
            ? suggestions.map(({ task, reason }) => (
                <button
                  key={task.id}
                  type="button"
                  className="note-connection-chip suggestion"
                  onClick={() => onLink(task.id)}
                  disabled={isBusy}
                  title={`연결: ${reason}`}
                >
                  + {task.title}
                  <small>{formatDateTime(task.startAt, timeFormat)}</small>
                </button>
              ))
            : null}
          {linkedTasks.length === 0 && suggestions.length === 0 ? <span className="note-connection-empty">없음</span> : null}
        </div>
      </div>

      <div className="note-connection-group">
        <span className="note-connection-label">관련 노트</span>
        <div className="note-connection-chips">
          {relatedNotes.length > 0
            ? relatedNotes.map(({ note, reason, isOriginal }) => (
                <button
                  key={note.id}
                  type="button"
                  className="note-connection-chip related"
                  onClick={() => onOpenNote(note.id)}
                  title={reason}
                >
                  {isOriginal ? <span className="note-connection-origin-badge">[원본]</span> : null}
                  <span>{note.title}</span>
                </button>
              ))
            : <span className="note-connection-empty">없음</span>}
        </div>
      </div>
    </section>
  );
}
