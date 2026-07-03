import { useMemo, useState, type ReactNode } from "react";
import { diffWords, summarizeDiff, diffLines } from "../utils/lineDiff";
import { MarkdownRenderer } from "./MarkdownRenderer";

type DiffView = "diff" | "original" | "proposed";

interface NoteInlineDiffProps {
  previous: string;
  next: string;
  headline?: string;
  mode: "proposal" | "compare";
  isApplying?: boolean;
  onAccept?: () => void;
  onReject: () => void;
}

function renderInlineDiff(previous: string, next: string): ReactNode[] {
  const tokens = diffWords(previous, next);
  const nodes: ReactNode[] = [];
  tokens.forEach((token, i) => {
    if (token.text === "\n") {
      nodes.push(<br key={`br-${i}`} />);
      return;
    }
    if (token.type === "equal") {
      nodes.push(<span key={i}>{token.text}</span>);
    } else if (token.type === "add") {
      nodes.push(
        <span key={i} className="diff-ins">
          {token.text}
        </span>,
      );
    } else {
      nodes.push(
        <span key={i} className="diff-del">
          {token.text}
        </span>,
      );
    }
  });
  return nodes;
}

export function NoteInlineDiff({ previous, next, headline, mode, isApplying, onAccept, onReject }: NoteInlineDiffProps) {
  const [view, setView] = useState<DiffView>("diff");
  const stats = useMemo(() => summarizeDiff(diffLines(previous, next)), [previous, next]);
  const inlineNodes = useMemo(() => renderInlineDiff(previous, next), [previous, next]);

  return (
    <section className="note-inline-diff" aria-label="변경 내용">
      <header className="note-inline-diff-header">
        <div className="note-inline-diff-title">
          <span className="note-inline-diff-headline">{headline ?? "변경 내용"}</span>
          <span className="note-inline-diff-stats">
            <span className="diff-added">+{stats.added}</span> <span className="diff-removed">−{stats.removed}</span>
          </span>
        </div>
        <div className="note-inline-diff-actions">
          <div className="note-diff-view-toggle" role="group" aria-label="보기 전환">
            <button type="button" className={view === "diff" ? "active" : ""} onClick={() => setView("diff")}>
              변경
            </button>
            <button type="button" className={view === "original" ? "active" : ""} onClick={() => setView("original")}>
              원본
            </button>
            <button type="button" className={view === "proposed" ? "active" : ""} onClick={() => setView("proposed")}>
              제안
            </button>
          </div>
          {mode === "proposal" ? (
            <>
              <button type="button" className="btn btn-outline btn-compact" onClick={onReject} disabled={isApplying}>
                거절
              </button>
              <button type="button" className="btn btn-primary btn-compact" onClick={onAccept} disabled={isApplying}>
                {isApplying ? "적용 중" : "적용"}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-soft btn-compact" onClick={onReject}>
              닫기
            </button>
          )}
        </div>
      </header>

      <div className="note-inline-diff-body">
        {view === "diff" ? (
          <div className="note-inline-diff-text">{inlineNodes}</div>
        ) : view === "original" ? (
          <MarkdownRenderer content={previous} emptyText="원본이 비어 있습니다." />
        ) : (
          <MarkdownRenderer content={next} emptyText="제안 내용이 비어 있습니다." />
        )}
      </div>

      <p className="note-inline-diff-legend">
        <span className="diff-ins">파란 밑줄</span> 추가 · <span className="diff-del">빨간 취소선</span> 삭제
      </p>
    </section>
  );
}
