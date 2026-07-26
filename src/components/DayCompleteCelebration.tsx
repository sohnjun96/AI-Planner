import type { CSSProperties } from "react";

export const DAY_COMPLETE_CELEBRATION_DURATION_MS = 4600;

const CONFETTI_COLORS = ["#3b82f6", "#f0b84b", "#46bfa3", "#ef7797", "#60a5fa", "#8b5cf6"];

type ConfettiStyle = CSSProperties & {
  "--confetti-x": string;
  "--confetti-y": string;
  "--confetti-rotation": string;
  "--confetti-delay": string;
  "--confetti-duration": string;
  "--confetti-color": string;
  "--confetti-size": string;
};

const CONFETTI_PIECES = Array.from({ length: 84 }, (_, index) => {
  const spread = (((index * 47) % 101) / 100) * 92 - 46;
  const fallDistance = 220 + ((index * 67) % 220);
  const rotation = -540 + ((index * 137) % 1080);
  const delay = (index * 83) % 1250;
  const duration = 2300 + ((index * 61) % 900);
  const size = 5 + ((index * 3) % 6);
  const style: ConfettiStyle = {
    "--confetti-x": `${spread.toFixed(1)}vw`,
    "--confetti-y": `${fallDistance}px`,
    "--confetti-rotation": `${rotation}deg`,
    "--confetti-delay": `${delay}ms`,
    "--confetti-duration": `${duration}ms`,
    "--confetti-color": CONFETTI_COLORS[index % CONFETTI_COLORS.length],
    "--confetti-size": `${size}px`,
  };
  return { id: index, style };
});

export function DayCompleteCelebration() {
  return (
    <div className="day-complete-celebration" role="status" aria-live="polite" aria-atomic="true">
      <div className="day-complete-confetti" aria-hidden="true">
        {CONFETTI_PIECES.map((piece) => (
          <span key={piece.id} style={piece.style} />
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
