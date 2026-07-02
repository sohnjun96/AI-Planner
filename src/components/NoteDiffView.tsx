import { useMemo } from "react";
import { diffLines, summarizeDiff } from "../utils/lineDiff";

interface NoteDiffViewProps {
  previous: string;
  next: string;
  onAccept: () => void;
  onReject: () => void;
  isApplying?: boolean;
  headline?: string;
}

export function NoteDiffView({ previous, next, onAccept, onReject, isApplying, headline }: NoteDiffViewProps) {
  const lines = useMemo(() => diffLines(previous, next), [previous, next]);
  const stats = useMemo(() => summarizeDiff(lines), [lines]);

  return (
    <section className="note-diff-view" aria-label="AI 제안 변경 내용">
      <header className="note-diff-header">
        <div>
          <p className="eyebrow">AI 제안</p>
          <h3>{headline ?? "변경 내용을 확인하세요"}</h3>
          <small className="note-diff-stats">
            <span className="diff-added">+{stats.added}</span> <span className="diff-removed">-{stats.removed}</span> 줄 변경
          </small>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-outline" onClick={onReject} disabled={isApplying}>
            거절
          </button>
          <button type="button" className="btn btn-primary" onClick={onAccept} disabled={isApplying}>
            {isApplying ? "적용 중" : "적용"}
          </button>
        </div>
      </header>

      <div className="note-diff-body" role="list">
        {lines.map((line, index) => (
          <div key={index} className={`note-diff-line diff-${line.type}`} role="listitem">
            <span className="note-diff-gutter" aria-hidden="true">
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : ""}
            </span>
            <span className="note-diff-text">{line.text || " "}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
