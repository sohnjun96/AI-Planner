import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { generateNoteTitleWithAi } from "../agent/noteTitleAgent";
import { generationOptionsFromSetting } from "../agent/llmClient";
import { DEFAULT_PROJECT_ID } from "../constants";
import { useAppData } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { deriveNoteTitle } from "../utils/noteTitle";
import { AiAssistantWorkspace } from "./AiAssistantWorkspace";
import { AskDataModal } from "./AskDataModal";
import { HelpModal } from "./HelpModal";
import { NoteQuickAddModal } from "./NoteQuickAddModal";
import { ToastHost, showToast } from "./ToastHost";
import { WeeklyBackupReminder } from "./WeeklyBackupReminder";

const NAV_ITEMS = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/notes", label: "노트" },
  { to: "/projects", label: "프로젝트" },
  { to: "/archive", label: "완료 기록" },
  { to: "/settings", label: "설정" },
];

type AiScheduleOpenDetail = {
  initialDraft?: string;
};

export function AppShell() {
  const { undoLastChange, projects, setting, createNote } = useAppData();
  const navigate = useNavigate();
  const [isAiAddOpen, setIsAiAddOpen] = useState(false);
  const [aiInitialDraft, setAiInitialDraft] = useState("");
  const [aiSessionRevision, setAiSessionRevision] = useState(0);
  const [isNoteAddOpen, setIsNoteAddOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const quickActionsRef = useRef<HTMLDivElement | null>(null);
  const aiDialogRef = useDialogFocus<HTMLElement>({
    isOpen: isAiAddOpen,
    onClose: () => setIsAiAddOpen(false),
  });

  const activeProjectId = useMemo(
    () => projects.find((project) => project.isActive)?.id ?? projects[0]?.id ?? DEFAULT_PROJECT_ID,
    [projects],
  );

  async function handleQuickCreateNote(content: string) {
    const fallbackTitle = deriveNoteTitle(content) || "새 노트";
    let title = fallbackTitle;
    if ((setting.llmEndpoint ?? "").trim()) {
      try {
        title = await generateNoteTitleWithAi({
          content,
          endpoint: setting.llmEndpoint,
          apiKey: setting.llmApiKey ?? "",
          model: setting.llmModel,
          generationOptions: generationOptionsFromSetting(setting),
        });
      } catch (error) {
        console.warn("AI note title generation failed", error);
      }
    }
    const id = await createNote({
      title,
      content,
      projectId: activeProjectId,
      subcategoryId: undefined,
      tags: [],
      status: "draft",
      isPinned: false,
    });
    setIsNoteAddOpen(false);
    showToast("노트를 만들었습니다.");
    navigate("/notes");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("ai-planner:focus-note", { detail: { noteId: id } }));
    }, 80);
  }

  function rememberMobileQuickActionsTrigger() {
    document.getElementById("top-nav-mobile-trigger")?.focus();
  }

  useEffect(() => {
    if (!isQuickActionsOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !quickActionsRef.current?.contains(event.target)) {
        setIsQuickActionsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [isQuickActionsOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasVisibleDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).some(
        (dialog) => dialog.getClientRects().length > 0,
      );
      const hasVisibleMenu = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]')).some(
        (menu) => menu.getClientRects().length > 0,
      );
      const hasVisibleQuickActions = Boolean(document.querySelector(".top-nav-mobile-panel"));

      if (event.key === "Escape") {
        if (!hasVisibleDialog && !hasVisibleMenu) {
          setIsQuickActionsOpen(false);
        }
        return;
      }

      if (hasVisibleDialog || hasVisibleMenu || hasVisibleQuickActions) {
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

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setIsAiAddOpen(true);
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setIsAiAddOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [undoLastChange]);

  useEffect(() => {
    const handleOpenAiSchedule = (event: Event) => {
      const detail = (event as CustomEvent<AiScheduleOpenDetail>).detail;
      if (detail?.initialDraft !== undefined) {
        setAiInitialDraft(detail.initialDraft);
        setAiSessionRevision((revision) => revision + 1);
      }
      setIsAiAddOpen(true);
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
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>

      <header className="app-top-nav">
        <NavLink className="top-nav-brand" to="/dashboard" aria-label="일정아이 대시보드로 이동">
          <span className="brand-mark">AI</span>
          <div>
            <p className="eyebrow">AI Planner</p>
            <h1>일정아이</h1>
          </div>
        </NavLink>

        <nav className="top-nav-list" aria-label="페이지 이동">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
              onClick={() => setIsQuickActionsOpen(false)}
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

            <button type="button" className="btn btn-soft" onClick={() => setIsNoteAddOpen(true)} aria-label="노트 추가">
              노트 추가
            </button>

            <button type="button" className="btn btn-primary" onClick={() => setIsAiAddOpen(true)} aria-label="AI 일정 추가, 단축키 A 또는 Ctrl+Shift+N">
              AI 일정 추가
            </button>
          </div>

          <div ref={quickActionsRef} className="top-nav-mobile-actions">
            <button
              id="top-nav-mobile-trigger"
              type="button"
              className="btn btn-primary top-nav-mobile-trigger"
              aria-expanded={isQuickActionsOpen}
              aria-controls="top-nav-quick-actions"
              onClick={() => setIsQuickActionsOpen((open) => !open)}
            >
              빠른 작업
            </button>
            {isQuickActionsOpen ? (
              <div id="top-nav-quick-actions" className="top-nav-mobile-panel" aria-label="빠른 작업">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    rememberMobileQuickActionsTrigger();
                    setIsQuickActionsOpen(false);
                    setIsAiAddOpen(true);
                  }}
                >
                  일정 AI 추가
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => {
                    rememberMobileQuickActionsTrigger();
                    setIsQuickActionsOpen(false);
                    setIsNoteAddOpen(true);
                  }}
                >
                  노트 추가
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => {
                    rememberMobileQuickActionsTrigger();
                    setIsQuickActionsOpen(false);
                    setIsAskOpen(true);
                  }}
                >
                  내 데이터 질문
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => {
                    rememberMobileQuickActionsTrigger();
                    setIsQuickActionsOpen(false);
                    setIsHelpOpen(true);
                  }}
                >
                  도움말
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="page-content" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="app-copyright">(c) 2026. 손준혁 All rights reserved.</footer>

      <div
        className="modal-backdrop"
        hidden={!isAiAddOpen}
        onClick={() => {
          setIsAiAddOpen(false);
        }}
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
                onClick={() => {
                  setIsAiAddOpen(false);
                }}
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
                setIsAiAddOpen(false);
              }}
              onRequestClose={() => setIsAiAddOpen(false)}
              onDraftPreserved={setAiInitialDraft}
              onOpenAiSettings={() => {
                setIsAiAddOpen(false);
                navigate("/settings?section=ai");
              }}
            />
          </section>
      </div>

      {isNoteAddOpen ? (
        <NoteQuickAddModal onCreate={handleQuickCreateNote} onClose={() => setIsNoteAddOpen(false)} />
      ) : null}

      {isHelpOpen ? <HelpModal onClose={() => setIsHelpOpen(false)} /> : null}

      {isAskOpen ? <AskDataModal onClose={() => setIsAskOpen(false)} /> : null}

      <WeeklyBackupReminder />

      <ToastHost />
    </div>
  );
}
