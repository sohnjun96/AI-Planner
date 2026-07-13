import { TASK_VIEW_MODES, type TaskViewMode } from "../constants/taskViewModes";

interface TaskViewSegmentedControlProps {
  value?: TaskViewMode;
  onChange: (mode: TaskViewMode) => void;
  ariaLabel?: string;
}

export function TaskViewSegmentedControl({ value, onChange, ariaLabel = "일정 보기 방식" }: TaskViewSegmentedControlProps) {
  return (
    <div className="segmented-control" role="group" aria-label={ariaLabel}>
      {TASK_VIEW_MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          className={value === mode.value ? "active" : ""}
          onClick={() => onChange(mode.value)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
