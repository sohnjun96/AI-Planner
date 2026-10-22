import { useCallback, useEffect, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { DEFAULT_PROJECT_IDS } from "../constants";

export type OnboardingStep = "connection" | "project" | "schedule" | "shortcut" | "completed";
interface OnboardingState {
  step: OnboardingStep;
  paused: boolean;
  afterConnection?: "project" | "schedule";
}
const STORAGE_KEY = "planai_onboarding_v1";
const STEPS: OnboardingStep[] = ["connection", "project", "schedule", "shortcut", "completed"];

interface GuideReadiness {
  hasKey: boolean;
  hasProjects: boolean;
  hasTasks: boolean;
}

function nextNeededStep(step: OnboardingStep, { hasKey, hasProjects, hasTasks }: GuideReadiness): OnboardingStep {
  let next = step;
  if (next === "connection" && hasKey) next = "project";
  if (next === "project" && hasProjects) next = "schedule";
  if (next === "schedule" && hasTasks) next = "shortcut";
  return next;
}

function readState(readiness: GuideReadiness): OnboardingState {
  let saved: OnboardingState | undefined;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<OnboardingState> | null;
    if (value && STEPS.includes(value.step as OnboardingStep)) {
      saved = {
        step: value.step as OnboardingStep,
        paused: value.paused === true,
        afterConnection: value.afterConnection === "project" || value.afterConnection === "schedule" ? value.afterConnection : undefined,
      };
    }
  } catch { /* 저장 공간이 제한되어도 현재 실행에서는 안내를 사용할 수 있다. */ }
  if (saved) {
    if (saved.paused || saved.step === "completed") return saved;
    if (!readiness.hasKey && (saved.step === "project" || saved.step === "schedule")) {
      return { step: "connection", paused: false, afterConnection: saved.step };
    }
    const start = saved.step === "connection" && readiness.hasKey ? saved.afterConnection ?? "project" : saved.step;
    return { ...saved, step: nextNeededStep(start, readiness) };
  }
  return { step: nextNeededStep("connection", readiness), paused: false };
}

export function useOnboarding() {
  const { setting, projects, tasks } = useAppData();
  const hasKey = Boolean(setting.llmApiKey?.trim());
  // 자동으로 제공되는 기본 프로젝트는 사용자가 프로젝트를 만든 것으로 세지 않는다.
  const hasProjects = projects.some((project) => !DEFAULT_PROJECT_IDS.includes(project.id));
  const hasTasks = tasks.length > 0;
  const [state, setState] = useState(() => readState({ hasKey, hasProjects, hasTasks }));
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { /* API 키나 사용자 데이터는 이 안내 상태에 포함하지 않는다. */ }
  }, [state]);
  const go = useCallback((step: OnboardingStep) => setState({ step, paused: false }), []);
  const pause = useCallback(() => setState((previous) => ({ ...previous, paused: true })), []);
  const finish = useCallback(() => setState({ step: "completed", paused: false }), []);
  const requireConnection = useCallback((afterConnection: "project" | "schedule") => {
    setState({ step: "connection", paused: false, afterConnection });
  }, []);
  const resume = useCallback((): OnboardingStep => {
    const start = state.step === "completed" ? "connection"
      : state.step === "connection" && hasKey ? state.afterConnection ?? "project" : state.step;
    let next: OnboardingStep = start;
    if (!hasKey && (next === "project" || next === "schedule")) {
      setState({ step: "connection", paused: false, afterConnection: next });
      return "connection";
    }
    next = nextNeededStep(next, { hasKey, hasProjects, hasTasks });
    setState((previous) => ({ ...previous, step: next, paused: false }));
    return next;
  }, [hasKey, hasProjects, hasTasks, state.afterConnection, state.step]);
  const nextAfterConnection = nextNeededStep(state.afterConnection ?? "project", { hasKey: true, hasProjects, hasTasks });
  const nextAfterProject = nextNeededStep("schedule", { hasKey, hasProjects: true, hasTasks });
  return { ...state, hasKey, nextAfterConnection, nextAfterProject, active: !state.paused && state.step !== "completed", go, pause, finish, resume, requireConnection };
}
