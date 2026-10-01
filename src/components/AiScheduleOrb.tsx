import { ThinkingOrb } from "thinking-orbs";

/** Keep both phases mounted during the crossfade so their motion stays continuous.
 * Match the approved preview: draw the 64px preset at 48 CSS pixels.
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
            color="#2563eb"
            theme="light"
            style={{ width: 48, height: 48 }}
          />
          <ThinkingOrb
            className="ai-add-orb-layer ai-add-orb-solving"
            state="solving"
            size={64}
            color="#2563eb"
            theme="light"
            style={{ width: 48, height: 48 }}
          />
        </>
      ) : null}
    </span>
  );
}
