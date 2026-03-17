import { COLOR_PRESETS, pickRandomPresetColor } from "../constants";

interface ColorSelectorProps {
  value: string;
  onChange: (nextColor: string) => void;
}

export function ColorSelector({ value, onChange }: ColorSelectorProps) {
  return (
    <div className="color-selector">
      <div className="color-preset-grid">
        {COLOR_PRESETS.map((color) => {
          const selected = value.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              className={`color-preset-button ${selected ? "selected" : ""}`}
              style={{ backgroundColor: color }}
              onClick={() => onChange(color)}
              aria-label={`색상 선택 ${color}`}
              title={color}
            />
          );
        })}
      </div>

      <div className="color-tools">
        <button
          type="button"
          className="btn btn-soft"
          onClick={() => {
            onChange(pickRandomPresetColor(value));
          }}
        >
          랜덤
        </button>
        <label className="color-custom-input">
          직접 선택
          <input
            type="color"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        </label>
      </div>

      <p className="color-value">{value.toUpperCase()}</p>
    </div>
  );
}
