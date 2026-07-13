import type { NoteVersion, NoteVersionEditType } from "../models";
import { formatDateTime } from "../utils/date";

interface NoteHistoryPanelProps {
  versions: NoteVersion[];
  timeFormat: "24h" | "12h";
  onRestore: (versionId: string) => void;
  onCompare: (version: NoteVersion) => void;
  onClose?: () => void;
  activeVersionId?: string;
}

const EDIT_TYPE_LABELS: Record<NoteVersionEditType, string> = {
  manual: "직접 수정",
  ai_full: "AI 전체 편집",
  ai_inline: "AI 인라인 편집",
  autosave: "자동 저장",
  restore: "버전 복원",
};

export function NoteHistoryPanel({ versions, timeFormat, onRestore, onCompare, onClose, activeVersionId }: NoteHistoryPanelProps) {
  const sorted = [...versions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <section className="note-panel note-history-panel">
      <header className="panel-header">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h3>변경 이력</h3>
          <small>{sorted.length}개 버전</small>
        </div>
        {onClose ? (
          <button type="button" className="btn btn-soft" onClick={onClose}>
            닫기
          </button>
        ) : null}
      </header>

      {sorted.length === 0 ? (
        <p className="empty-text">아직 저장된 버전이 없습니다.</p>
      ) : (
        <ul className="note-history-list">
          {sorted.map((version, index) => (
            <li key={version.id} className={`note-history-item ${version.id === activeVersionId ? "active" : ""}`}>
              <div className="note-history-info">
                <span className={`note-history-badge edit-${version.editType}`}>{EDIT_TYPE_LABELS[version.editType]}</span>
                <time>{formatDateTime(version.createdAt, timeFormat)}</time>
                {index === 0 ? <span className="note-history-current">현재</span> : null}
              </div>
              <div className="button-row">
                <button type="button" className="btn btn-soft btn-compact" onClick={() => onCompare(version)}>
                  비교
                </button>
                {index === 0 ? null : (
                  <button type="button" className="btn btn-outline btn-compact" onClick={() => onRestore(version.id)}>
                    복원
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
