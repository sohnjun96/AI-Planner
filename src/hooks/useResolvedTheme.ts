import { useSyncExternalStore } from "react";
import { getResolvedTheme, subscribeThemeChange } from "../utils/theme";

export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribeThemeChange, getResolvedTheme, () => "light");
}
