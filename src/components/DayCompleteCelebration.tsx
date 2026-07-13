const CONFETTI_PIECES = Array.from({ length: 36 }, (_, index) => index);

export function DayCompleteCelebration() {
  return (
    <div className="day-complete-celebration" role="status" aria-live="polite" aria-atomic="true">
      <div className="day-complete-confetti" aria-hidden="true">
        {CONFETTI_PIECES.map((piece) => (
          <span key={piece} />
        ))}
      </div>
      <div className="day-complete-sparkles" aria-hidden="true">
        <span>✦</span>
        <span>✧</span>
        <span>✦</span>
        <span>✧</span>
        <span>✦</span>
        <span>✧</span>
      </div>
      <div className="day-complete-banner">
        <span className="day-complete-icon" aria-hidden="true">✓</span>
        <strong>오늘 일정은 모두 마쳤어요. 수고했어요.</strong>
      </div>
    </div>
  );
}
