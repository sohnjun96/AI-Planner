import { STATUS_LABELS } from "../constants";
import type { Task } from "../models";
import { formatDateTime } from "../utils/date";

interface SuggestedTask {
  task: Task;
  reason: string;
}

interface NoteConnectionsProps {
  linkedTasks: Task[];
  suggestions: SuggestedTask[];
  timeFormat: "24h" | "12h";
  onOpenTask: (taskId: string) => void;
  onLink: (taskId: string) => void;
  onUnlink: (taskId: string) => void;
  isBusy?: boolean;
}

export function NoteConnections({
  linkedTasks,
  suggestions,
  timeFormat,
  onOpenTask,
  onLink,
  onUnlink,
  isBusy,
}: NoteConnectionsProps) {
  // 연결된 일정도 추천도 없으면 아무것도 렌더링하지 않는다.
  if (linkedTasks.length === 0 && suggestions.length === 0) {
    return null;
  }

  return (
    <section className="note-connections">
      {linkedTasks.length > 0 ? (
        <div className="note-connection-group">
          <span className="note-connection-label">연결된 일정</span>
          <div className="note-connection-chips">
            {linkedTasks.map((task) => (
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
            ))}
          </div>
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="note-connection-group">
          <span className="note-connection-label">추천 일정</span>
          <div className="note-connection-chips">
            {suggestions.map(({ task, reason }) => (
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
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
