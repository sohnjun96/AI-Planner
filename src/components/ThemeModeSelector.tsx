import { useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useResolvedTheme } from "../hooks/useResolvedTheme";
import type { ThemeMode } from "../models";

const OPTIONS: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: "system", label: "시스템 설정", description: "크롬·윈도우 설정에 맞춤" },
  { value: "light", label: "라이트", description: "항상 밝은 화면" },
  { value: "dark", label: "다크", description: "항상 어두운 화면" },
];

export function ThemeModeSelector() {
  const { setting, updateSetting } = useAppData();
  const resolvedTheme = useResolvedTheme();
  const [error, setError] = useState("");
  const themeMode = setting.themeMode ?? "system";
  const appliedLabel = resolvedTheme === "dark" ? "다크" : "라이트";

  async function selectMode(mode: ThemeMode) {
    setError("");
    try {
      await updateSetting({ themeMode: mode });
    } catch {
      setError("화면 모드를 저장하지 못했습니다. 다시 선택해 주세요.");
    }
  }

  return (
    <section className="settings-card settings-theme-card" aria-labelledby="theme-mode-heading">
      <header className="settings-card-header"><h3 id="theme-mode-heading">화면 모드</h3></header>
      <p className="description-text" id="theme-mode-description">기기의 설정에 맞추거나, 편한 화면 모드를 직접 선택하세요.</p>
      <fieldset className="theme-mode-fieldset" aria-describedby="theme-mode-description">
        <legend className="sr-only">화면 모드 선택</legend>
        <div className="theme-mode-options">
          {OPTIONS.map((option) => (
            <label className="theme-mode-option" key={option.value}>
              <span className={`theme-mode-preview preview-${option.value}`} aria-hidden="true">
                <span className="theme-preview-sidebar"><span /><span /><span /></span>
                <span className="theme-preview-content"><span /><span /><span /></span>
              </span>
              <span className="theme-mode-label"><input type="radio" name="themeMode" value={option.value} aria-label={option.label} checked={themeMode === option.value} onChange={() => void selectMode(option.value)} /><strong>{option.label}</strong>{option.value === "system" ? <small>기본</small> : null}</span>
              <span className="theme-mode-help">{option.description}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="theme-mode-status" role="status" aria-live="polite" aria-atomic="true">
        <strong>현재 적용: {appliedLabel}</strong>
        <span>{themeMode === "system" ? "크롬이 전달하는 화면 설정에 따라 자동으로 전환됩니다." : "크롬·윈도우 설정이 바뀌어도 선택한 화면 모드를 유지합니다."}</span>
      </p>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </section>
  );
}
