import { ThinkingOrb } from "thinking-orbs";

/** Keep both phases mounted during the crossfade so their motion stays continuous.
 * Use the same larger, stronger dots in the floating button and modal.
 */
export function AiScheduleOrb({ active }: { active: boolean }) {
  return (
    <span className="ai-add-modal-orb" aria-hidden="true">
      {active ? (
        <>
          <ThinkingOrb
            className="ai-add-orb-layer ai-add-orb-listening"
            state="listening"
            size={64}
            color="#1d4ed8"
            dotSize={1.6}
            theme="light"
            style={{ width: 52, height: 52 }}
          />
          <ThinkingOrb
            className="ai-add-orb-layer ai-add-orb-solving"
            state="solving"
            size={64}
            color="#1d4ed8"
            dotSize={1.6}
            theme="light"
            style={{ width: 52, height: 52 }}
          />
        </>
      ) : null}
    </span>
  );
}
