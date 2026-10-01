import type { LunchMateGroup } from "../agent/lunchMateAgent";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";

interface LunchMateRankingModalProps {
  groups: LunchMateGroup[];
  periodLabel: string;
  isAnalyzing: boolean;
  hasAiAnalysis: boolean;
  analysisError: string;
  onRetry: () => void;
  onClose: () => void;
}

export function LunchMateRankingModal({
  groups,
  periodLabel,
  isAnalyzing,
  hasAiAnalysis,
  analysisError,
  onRetry,
  onClose,
}: LunchMateRankingModalProps) {
  const dialogRef = useDialogFocus<HTMLElement>({ isOpen: true, onClose });
  const rankByCount = groups.reduce((ranks, group, index) => {
    if (!ranks.has(group.count)) ranks.set(group.count, index + 1);
    return ranks;
  }, new Map<number, number>());
  const rankedGroups = groups.map((group, index) => {
    const isTied = groups[index - 1]?.count === group.count || groups[index + 1]?.count === group.count;
    return { group, rank: rankByCount.get(group.count), isTied };
  });

  return (
    <ModalBackdrop className="modal-backdrop" onRequestClose={onClose}>
      <section
        ref={dialogRef}
        className="modal-card panel lunch-ranking-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lunch-ranking-title"
        aria-describedby="lunch-ranking-description"
        tabIndex={-1}
      >
        <header className="panel-header lunch-ranking-header">
          <div>
            <p className="eyebrow">LUNCH MATES</p>
            <h2 id="lunch-ranking-title">점심 메이트 랭킹</h2>
            <small id="lunch-ranking-description">{periodLabel} · 완료한 점심 기록 기준</small>
          </div>
          <button type="button" className="btn btn-soft" onClick={onClose} data-dialog-initial-focus>
            닫기
          </button>
        </header>

        <div className="lunch-ranking-status" role="status">
          <span className="lunch-ranking-total">점심 메이트 {groups.length}명</span>
          {isAnalyzing ? (
            <span>AI가 이름을 정리하고 있어요. 완료되면 랭킹에 반영됩니다.</span>
          ) : hasAiAnalysis ? (
            <span>같은 사람으로 정리된 이름의 횟수를 합산했어요.</span>
          ) : (
            <span>기록에 적힌 이름별로 함께 먹은 횟수를 모았어요.</span>
          )}
        </div>

        {analysisError ? (
          <div className="lunch-ranking-error">
            <p role="alert">{analysisError} 현재 집계된 랭킹은 계속 볼 수 있어요.</p>
            <button type="button" className="archive-card-action" disabled={isAnalyzing} onClick={onRetry}>
              {isAnalyzing ? "다시 정리 중" : "AI 정리 다시 시도"}
            </button>
          </div>
        ) : null}

        {rankedGroups.length > 0 ? (
          <ol className="lunch-ranking-list" aria-label="함께 점심 먹은 횟수 순위">
            {rankedGroups.map(({ group, rank: groupRank, isTied }, index) => (
              <li key={index} className={`lunch-ranking-row ${groupRank === 1 ? "first" : ""}`}>
                <span className="lunch-ranking-position">{isTied ? "공동 " : ""}{groupRank}위</span>
                <div className="lunch-ranking-person">
                  <strong>{group.displayName}</strong>
                  {group.aliases.some((alias) => alias !== group.displayName) ? (
                    <small>함께 집계한 이름: {group.aliases.join(" · ")}</small>
                  ) : null}
                </div>
                <span className="lunch-ranking-count"><strong>{group.count}</strong>회</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state lunch-ranking-empty">
            <h3>아직 점심 메이트 기록이 없습니다.</h3>
            <p>{periodLabel}에 완료한 점심 일정에 이름이 있으면 여기에 표시됩니다.</p>
          </div>
        )}
        <footer className="lunch-ranking-footer">횟수가 같으면 공동 순위로 표시합니다.</footer>
      </section>
    </ModalBackdrop>
  );
}
