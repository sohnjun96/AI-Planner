import { useEffect, useRef } from "react";
import type { OnboardingStep } from "../hooks/useOnboarding";
import "./FirstRunGuide.css";

interface FirstRunGuideProps {
  step: OnboardingStep;
  pathname: string;
  onProject: () => void;
  onSchedule: () => void;
  onPause: () => void;
  onFinish: () => void;
}

export function FirstRunGuide({ step, pathname, onProject, onSchedule, onPause, onFinish }: FirstRunGuideProps) {
  const finishRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (step !== "shortcut") return;
    const frame = window.requestAnimationFrame(() => finishRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [step]);

  if (step === "shortcut") {
    return (
      <section className="first-run-shortcut" aria-labelledby="first-run-shortcut-title" data-onboarding-step="shortcut">
        <p className="first-run-step">AI 일정 추가 빠른 사용법</p>
        <h2 id="first-run-shortcut-title">AI 일정 추가를 빠르게 열어 보세요</h2>
        <p>오른쪽 아래의 동그란 <strong>AI 일정 추가 버튼</strong>을 누르거나, <kbd>A</kbd> 키를 누르면 언제든 입력창을 열 수 있어요.</p>
        <small>글을 입력하고 있지 않을 때 단축키를 사용할 수 있습니다.</small>
        <button ref={finishRef} className="btn btn-primary" type="button" onClick={onFinish}>안내 마치기</button>
      </section>
    );
  }
  if (step !== "project" && step !== "schedule") return null;
  const projectStep = step === "project";
  return (
    <section className="first-run-banner" aria-labelledby="first-run-title" data-onboarding-step={step}>
      <div className="first-run-copy">
        <p className="first-run-step">시작 안내 · {projectStep ? "2" : "3"} / 3</p>
        <h2 id="first-run-title">{projectStep ? "업무별 프로젝트를 만들어 보세요" : "AI에게 첫 일정을 알려 주세요"}</h2>
        <p>{projectStep
          ? "업무별로 프로젝트를 추가하고 설명을 작성하면, AI가 일정 추가 시 알맞은 프로젝트로 자동 분류합니다."
          : "날짜와 할 일을 자연스럽게 입력하고, AI가 만든 초안을 확인한 뒤 반영하면 일정이 저장됩니다."}</p>
      </div>
      <div className="first-run-actions">
        <button className="btn btn-primary" type="button" onClick={projectStep ? onProject : onSchedule}>
          {projectStep ? pathname === "/projects" ? "프로젝트 만들기" : "프로젝트로 이동" : "첫 일정 입력하기"}
        </button>
        <button className="btn btn-soft" type="button" onClick={onPause}>나중에 하기</button>
      </div>
    </section>
  );
}
