import { RoutineNotifications } from "./RoutineNotifications";
import { useRoutines } from "../hooks/useRoutines";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useAppData } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useScheduleReminders } from "../hooks/useScheduleReminders";
import { NavLink, useLocation, useNavigate } from "../routing";
import { showToast } from "../utils/toast";
import { AiAssistantWorkspace } from "./AiAssistantWorkspace";
import { AiScheduleOrb } from "./AiScheduleOrb";
import { AskDataModal } from "./AskDataModal";
import { HelpModal } from "./HelpModal";
import { ModalBackdrop } from "./ModalBackdrop";
import { ToastHost } from "./ToastHost";
import { AppReminderStack } from "./AppReminderStack";
import { ScheduleReminderModal } from "./ScheduleReminderModal";
import { useOnboarding } from "../hooks/useOnboarding";
import { FirstRunGuide } from "./FirstRunGuide";
import { OnboardingConnectionDialog } from "./OnboardingConnectionDialog";

const planaiLogo = __PLANAI_APP_ICON_URL__;

const NAV_ITEMS = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/notes", label: "노트" },
  { to: "/routines", label: "나의 루틴" },
  { to: "/projects", label: "프로젝트" },
  { to: "/archive", label: "나의 기록" },
];

type AiScheduleOpenDetail = {
  initialDraft?: string;
};

export function AppShell({ children }: { children: ReactNode }) {
  const { undoLastChange, projects, taskTypes, setting } = useAppData();
  const { dueCount } = useRoutines();
  const location = useLocation();
  const navigate = useNavigate();
  const [isAiAddOpen, setIsAiAddOpen] = useState(false);
  const [aiInitialDraft, setAiInitialDraft] = useState("");
  const [aiSessionRevision, setAiSessionRevision] = useState(0);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [hasOtherDialog, setHasOtherDialog] = useState(true);
  const onboarding = useOnboarding();
  const onboardingRef = useRef(onboarding);
  onboardingRef.current = onboarding;
  const guideStartedRef = useRef(false);
  const reminders = useScheduleReminders(openAiScheduleSession);
  const isReminderOpen = reminders.isOpen && !hasOtherDialog && !isAiAddOpen && !isHelpOpen && !isAskOpen && !onboarding.active;
  const aiFabRef = useRef<HTMLButtonElement>(null);
  const topNavRef = useRef<HTMLElement>(null);
  const openedFromAiFab = useRef(false);

  // 고정 도구 모음이 줄바꿈·화면 확대 후에도 상단 메뉴 아래에 머물도록 한다.
  useEffect(() => {
    const topNav = topNavRef.current;
    const shell = topNav?.parentElement;
    if (!topNav || !shell) return;
    const updateHeight = () => shell.style.setProperty("--app-top-nav-height", `${topNav.getBoundingClientRect().height}px`);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(topNav);
    return () => observer.disconnect();
  }, []);
  const aiDialogRef = useDialogFocus<HTMLElement>({
    isOpen: isAiAddOpen,
    onClose: closeAiScheduleSession,
  });

  function openAiScheduleSession(initialDraft = "") {
    if (onboardingRef.current.active && onboardingRef.current.step === "shortcut") onboardingRef.current.finish();
    openedFromAiFab.current = document.activeElement === aiFabRef.current;
    setAiInitialDraft(initialDraft);
    setAiSessionRevision((revision) => revision + 1);
    setIsAiAddOpen(true);
  }

  function closeAiScheduleSession() {
    setIsAiAddOpen(false);
    // Hiding the trigger can move focus to body before useDialogFocus remembers it.
    if (openedFromAiFab.current) {
      openedFromAiFab.current = false;
      window.requestAnimationFrame(() => aiFabRef.current?.focus());
    }
  }

  function openGuideProject() {
    if (!setting.llmApiKey?.trim()) {
      onboarding.requireConnection("project");
      return;
    }
    navigate("/projects?setup=project");
  }

  function openGuideSchedule() {
    if (!setting.llmApiKey?.trim()) {
      onboarding.requireConnection("schedule");
      return;
    }
    navigate("/dashboard");
    openAiScheduleSession();
  }

  function handleGuideConnected() {
    const next = onboarding.nextAfterConnection;
    onboarding.go(next);
    if (next === "project") {
      navigate("/projects?setup=project");
    } else {
      navigate("/dashboard");
      if (next === "schedule") openAiScheduleSession();
    }
  }

  function resumeGuide() {
    setIsHelpOpen(false);
    const step = onboarding.resume();
    if (step === "project") navigate("/projects?setup=project");
    if (step === "schedule") {
      navigate("/dashboard");
      openAiScheduleSession();
    }
  }

  // 처음 실행하거나 새로고침해도 저장한 단계의 실제 작업 화면으로 안내한다.
  useEffect(() => {
    if (guideStartedRef.current || hasOtherDialog) return;
    guideStartedRef.current = true;
    const guide = onboardingRef.current;
    if (!guide.active) return;
    if (guide.step === "project" && location.pathname !== "/projects") navigate("/projects?setup=project", { replace: true });
    if (guide.step === "schedule") {
      navigate("/dashboard", { replace: true });
      openAiScheduleSession();
    }
  }, [hasOtherDialog, location.pathname, navigate]);

  useEffect(() => {
    const projectCreated = () => {
      const guide = onboardingRef.current;
      if (!guide.active || guide.step !== "project") return;
      if (!guide.hasKey) {
        guide.requireConnection("schedule");
        return;
      }
      const next = guide.nextAfterProject;
      guide.go(next);
      navigate("/dashboard");
      if (next === "schedule") openAiScheduleSession();
    };
    window.addEventListener("ai-planner:onboarding-project-created", projectCreated);
    return () => window.removeEventListener("ai-planner:onboarding-project-created", projectCreated);
  }, [navigate]);

  // Wait until an existing editing dialog closes before presenting reminders.
  useEffect(() => {
    const checkDialogs = () => setHasOtherDialog(Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .some((dialog) => dialog.id !== "schedule-reminder-dialog" && dialog.id !== "onboarding-connection-dialog" && dialog.getClientRects().length > 0));
    const observer = new MutationObserver(checkDialogs);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "class"] });
    const timer = window.setTimeout(checkDialogs, 0);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, []);

  const openNewNote = useCallback(() => {
    if (location.pathname !== "/notes") {
      navigate("/notes");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("ai-planner:create-note")), 80);
      return;
    }
    window.dispatchEvent(new CustomEvent("ai-planner:create-note"));
  }, [location.pathname, navigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasVisibleDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(
        (dialog) => dialog.getClientRects().length > 0,
      );
      const hasVisibleMenu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).some(
        (menu) => menu.getClientRects().length > 0,
      );

      if (event.key === "Escape") {
        return;
      }

      if (hasVisibleDialog || hasVisibleMenu) {
        return;
      }

      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isEditableTarget) {
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setIsHelpOpen(true);
        return;
      }

      // Ctrl+Z: 마지막 일정 변경 실행 취소 (입력 필드 밖에서만 — 텍스트 undo와 충돌 방지)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undoLastChange().catch(() => {});
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openNewNote();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openAiScheduleSession();
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        openAiScheduleSession();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openNewNote, undoLastChange]);

  useEffect(() => {
    const handleOpenAiSchedule = (event: Event) => {
      const detail = (event as CustomEvent<AiScheduleOpenDetail>).detail;
      openAiScheduleSession(detail?.initialDraft ?? "");
    };

    window.addEventListener("ai-planner:open-ai-schedule", handleOpenAiSchedule);
    return () => {
      window.removeEventListener("ai-planner:open-ai-schedule", handleOpenAiSchedule);
    };
  }, []);

  // 일정 변경(추가/수정/삭제)마다 "실행 취소" 액션이 달린 토스트로 알려준다.
  useEffect(() => {
    const handleUndoable = (event: Event) => {
      const detail = (event as CustomEvent<{ description?: string }>).detail;
      if (!detail?.description) {
        return;
      }
      showToast(detail.description, {
        actionLabel: "실행 취소",
        onAction: () => {
          void undoLastChange().catch(() => {});
        },
      });
    };
    window.addEventListener("ai-planner:undoable", handleUndoable);
    return () => window.removeEventListener("ai-planner:undoable", handleUndoable);
  }, [undoLastChange]);

  return (
    <div className="app-shell">
      <RoutineNotifications />
      <a
        className="skip-link"
        href={`#${location.pathname}${location.search}`}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>

      <header className="app-top-nav" ref={topNavRef}>
        <NavLink className="top-nav-brand" to="/dashboard" aria-label="플래나이 대시보드로 이동">
          <img className="brand-mark" src={planaiLogo} alt="PLANAI 로고" />
          <div>
            <p className="eyebrow">PLANAI</p>
            <h1>플래나이</h1>
          </div>
        </NavLink>

        <nav className="top-nav-list" aria-label="페이지 이동">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              {item.label}{item.to === "/routines" && dueCount > 0 && <span className="routine-nav-badge">{dueCount}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="top-nav-actions">
            <button type="button" className="btn btn-soft top-nav-reminders" onClick={reminders.open}
              aria-label={`일정 알림${reminders.pendingTasks.length ? ` ${reminders.pendingTasks.length}건` : ""}`}
              title="일정 알림" aria-haspopup="dialog" aria-expanded={isReminderOpen} aria-controls="schedule-reminder-dialog">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
              </svg>
              <span className="top-nav-reminders-label">알림</span>
              {reminders.pendingTasks.length > 0 ? <span className="top-nav-reminders-count" aria-hidden="true">{reminders.pendingTasks.length > 99 ? "99+" : reminders.pendingTasks.length}</span> : null}
            </button>
            <button type="button" className="btn btn-soft" onClick={() => setIsAskOpen(true)} aria-label="내 데이터에 질문">
              질문
            </button>
            <NavLink to="/settings" className={({ isActive }) => `btn btn-soft btn-icon top-nav-settings${isActive ? " active" : ""}`} aria-label="설정" title="설정" aria-current={location.pathname === "/settings" ? "page" : undefined}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="m9.5 3-.5 2a8 8 0 0 0-1.5.9l-2-.6L3 9.5 4.5 11a8 8 0 0 0 0 2L3 14.5l2.5 4.2 2-.6A8 8 0 0 0 9 19l.5 2h5l.5-2a8 8 0 0 0 1.5-.9l2 .6 2.5-4.2-1.5-1.5a8 8 0 0 0 0-2L21 9.5l-2.5-4.2-2 .6A8 8 0 0 0 15 5l-.5-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </NavLink>
        </div>
      </header>

      <main className="page-content" id="main-content" tabIndex={-1}>
        {onboarding.active && !hasOtherDialog && !isAiAddOpen && !isHelpOpen && !isAskOpen ? (
          <FirstRunGuide step={onboarding.step} pathname={location.pathname}
            onProject={openGuideProject} onSchedule={openGuideSchedule}
            onPause={onboarding.pause} onFinish={onboarding.finish} />
        ) : null}
        <div key={location.pathname} className="route-transition">
          {children}
        </div>
      </main>

      <footer className="app-copyright">
        <span>(c) 2026. 손준혁 All rights reserved.</span>
        <button className="app-help-link" type="button" onClick={() => setIsHelpOpen(true)}>도움말</button>
      </footer>

      <button
        ref={aiFabRef}
        type="button"
        className={`ai-schedule-fab${onboarding.active && onboarding.step === "shortcut" ? " first-run-highlight" : ""}`}
        aria-label="AI 일정 추가"
        aria-haspopup="dialog"
        aria-expanded={isAiAddOpen}
        aria-controls="ai-schedule-dialog"
        title="AI 일정 추가 (A)"
        hidden={isAiAddOpen || isHelpOpen || isAskOpen || isReminderOpen}
        onClick={() => openAiScheduleSession()}
      >
        <AiScheduleOrb active={!isAiAddOpen && !isHelpOpen && !isAskOpen && !isReminderOpen} />
        <span className="ai-schedule-fab-plus" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" focusable="false">
            <path d="M6 2v8M2 6h8" />
          </svg>
        </span>
      </button>

      <ModalBackdrop
        className="modal-backdrop"
        hidden={!isAiAddOpen}
        onRequestClose={closeAiScheduleSession}
      >
          <section
            ref={aiDialogRef}
            id="ai-schedule-dialog"
            className="modal-card panel ai-add-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="AI 일정 추가"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header ai-add-modal-header">
              <div className="ai-add-modal-heading">
                <AiScheduleOrb active={isAiAddOpen} />
                <div>
                  <p className="eyebrow">AI SCHEDULE</p>
                  <h2>AI 일정 추가</h2>
                  <small>일정이 포함된 내용을 넣으면, AI가 일정 초안으로 정리해요</small>
                </div>
              </div>
              <button
                type="button"
                className="btn ai-add-modal-close"
                aria-label="AI 일정 추가 닫기"
                onClick={closeAiScheduleSession}
              >
                닫기
              </button>
            </header>

            {onboarding.active && onboarding.step === "schedule" ? (
              <div className="first-run-ai-hint" data-onboarding-step="schedule-input">
                <p><strong>시작 안내 · 3 / 3</strong> — 첫 일정을 입력해 보세요.<br />예: 내일 오전 10시 마케팅 회의 1시간 추가. 초안을 확인하고 반영하면 저장됩니다.</p>
                <button className="btn btn-soft" type="button" onClick={onboarding.pause}>안내 그만보기</button>
              </div>
            ) : null}

            <AiAssistantWorkspace
              key={`ai-schedule-session-${aiSessionRevision}`}
              isActive={isAiAddOpen}
              compact
              showHeader={false}
              hideInitialResult
              showRetryButton={false}
              showEndpointInfo={false}
              title="AI 일정 추가"
              inputLabel=""
              placeholder="예: 다음 주 월요일 오전 10시에 디자인 리뷰 1시간 추가"
              className="embedded ai-add-workspace"
              initialDraft={aiInitialDraft}
              onApplied={({ createdTaskCount }) => {
                setAiInitialDraft("");
                closeAiScheduleSession();
                if (onboarding.active && onboarding.step === "schedule" && createdTaskCount > 0) {
                  onboarding.go("shortcut");
                }
              }}
              onRequestClose={closeAiScheduleSession}
              onOpenAiSettings={() => {
                closeAiScheduleSession();
                navigate("/settings?section=ai");
              }}
            />
          </section>
      </ModalBackdrop>

      {isHelpOpen ? <HelpModal onClose={() => setIsHelpOpen(false)} onStartGuide={resumeGuide} /> : null}

      {isAskOpen ? <AskDataModal onClose={() => setIsAskOpen(false)} /> : null}

      {isReminderOpen && reminders.selectedTask ? (
        <ScheduleReminderModal tasks={reminders.pendingTasks} selectedTaskId={reminders.selectedTask.id}
          projects={projects} taskTypes={taskTypes} timeFormat={setting.timeFormat}
          onSelectTask={reminders.select} onStatusChange={reminders.changeStatus} onPostpone={reminders.postpone}
          onSnooze={reminders.snooze} onAcknowledge={reminders.acknowledgeSelected}
          onAcknowledgeAll={reminders.acknowledgeAll} onAiEdit={reminders.editWithAi} onClose={reminders.close} />
      ) : null}

      <AppReminderStack compact={location.pathname === "/notes"} />

      <ToastHost />
      {onboarding.active && onboarding.step === "connection" && !hasOtherDialog && !isAiAddOpen && !isHelpOpen && !isAskOpen ? (
        <OnboardingConnectionDialog onConnected={handleGuideConnected} onSkip={onboarding.pause} />
      ) : null}
    </div>
  );
}
