import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAppData } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { NavLink, useLocation, useNavigate } from "../routing";
import { showToast } from "../utils/toast";
import { AiAssistantWorkspace } from "./AiAssistantWorkspace";
import { AskDataModal } from "./AskDataModal";
import { HelpModal } from "./HelpModal";
import { ModalBackdrop } from "./ModalBackdrop";
import { ToastHost } from "./ToastHost";
import { WeeklyBackupReminder } from "./WeeklyBackupReminder";

const planaiLogo = __PLANAI_APP_ICON_URL__;

const NAV_ITEMS = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/notes", label: "노트" },
  { to: "/projects", label: "프로젝트" },
  { to: "/archive", label: "나의 기록" },
  { to: "/settings", label: "설정" },
];

type AiScheduleOpenDetail = {
  initialDraft?: string;
};

export function AppShell({ children }: { children: ReactNode }) {
  const { undoLastChange } = useAppData();
  const location = useLocation();
  const navigate = useNavigate();
  const [isAiAddOpen, setIsAiAddOpen] = useState(false);
  const [aiInitialDraft, setAiInitialDraft] = useState("");
  const [aiSessionRevision, setAiSessionRevision] = useState(0);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const aiDialogRef = useDialogFocus<HTMLElement>({
    isOpen: isAiAddOpen,
    onClose: closeAiScheduleSession,
  });

  function openAiScheduleSession(initialDraft = "") {
    setAiInitialDraft(initialDraft);
    setAiSessionRevision((revision) => revision + 1);
    setIsAiAddOpen(true);
  }

  function closeAiScheduleSession() {
    setIsAiAddOpen(false);
  }

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

      <header className="app-top-nav">
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
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="top-nav-actions">
          <div className="top-nav-desktop-actions">
            {/* 되돌리기 버튼은 제거 — 변경 직후 토스트의 '실행 취소'와 Ctrl+Z가 대체한다 */}
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setIsHelpOpen(true)}
              aria-label="도움말과 단축키 (물음표 키)"
              title="도움말 · 단축키 (?)"
            >
              ?
            </button>

            <button type="button" className="btn btn-soft" onClick={() => setIsAskOpen(true)} aria-label="내 데이터에 질문">
              질문
            </button>
          </div>

          <div className="top-nav-primary-actions">
            <button type="button" className="btn btn-soft" onClick={openNewNote} aria-label="노트 추가, Ctrl+N">
              노트 추가
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openAiScheduleSession()}>
              AI 일정 추가
            </button>
          </div>
        </div>
      </header>

      <main className="page-content" id="main-content" tabIndex={-1}>
        <div key={location.pathname} className="route-transition">
          {children}
        </div>
      </main>

      <footer className="app-copyright">(c) 2026. 손준혁 All rights reserved.</footer>

      <ModalBackdrop
        className="modal-backdrop"
        hidden={!isAiAddOpen}
        onRequestClose={closeAiScheduleSession}
      >
          <section
            ref={aiDialogRef}
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
                <span className="ai-add-modal-orb" aria-hidden="true">
                  <span />
                  <span />
                  <i />
                </span>
                <div>
                  <p className="eyebrow">AI SCHEDULE</p>
                  <h2>AI 일정 추가</h2>
                  <small>원하는 시간을 자연스럽게 말하면, 확인할 수 있는 일정 초안으로 정리해요.</small>
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
              onApplied={() => {
                setAiInitialDraft("");
                closeAiScheduleSession();
              }}
              onRequestClose={closeAiScheduleSession}
              onOpenAiSettings={() => {
                closeAiScheduleSession();
                navigate("/settings?section=ai");
              }}
            />
          </section>
      </ModalBackdrop>

      {isHelpOpen ? <HelpModal onClose={() => setIsHelpOpen(false)} /> : null}

      {isAskOpen ? <AskDataModal onClose={() => setIsAskOpen(false)} /> : null}

      <WeeklyBackupReminder compact={location.pathname === "/notes"} />

      <ToastHost />
    </div>
  );
}
