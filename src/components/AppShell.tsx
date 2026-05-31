import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";
import { AiAssistantWorkspace } from "./AiAssistantWorkspace";

const NAV_ITEMS = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/projects", label: "프로젝트" },
  { to: "/archive", label: "보관함" },
  { to: "/settings", label: "설정" },
];

export function AppShell() {
  const { canUndo, undoLastChange, undoDescription } = useAppData();
  const [isAiAddOpen, setIsAiAddOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAiAddOpen(false);
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
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>

      <header className="app-top-nav">
        <div className="top-nav-brand" aria-label="AI Planner">
          <span className="brand-mark">AP</span>
          <div>
            <p className="eyebrow">AI PLANNER</p>
            <h1>업무 일정관리</h1>
          </div>
        </div>

        <nav className="top-nav-list" aria-label="페이지 이동">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="top-nav-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              void undoLastChange().catch(() => {});
            }}
            disabled={!canUndo}
            title={undoDescription ?? "되돌릴 작업이 없습니다."}
          >
            되돌리기
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setIsAiAddOpen(true);
            }}
            aria-label="AI 일정 추가, 단축키 A 또는 Ctrl+Shift+N"
          >
            AI 일정 추가
          </button>
        </div>
      </header>

      <main className="page-content" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>

      {isAiAddOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsAiAddOpen(false);
          }}
        >
          <section
            className="modal-card panel ai-add-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="AI 일정 추가"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <div>
                <p className="eyebrow">AI SCHEDULE</p>
                <h2>AI 일정 추가</h2>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setIsAiAddOpen(false);
                }}
              >
                닫기
              </button>
            </header>

            <AiAssistantWorkspace
              compact
              hideInitialResult
              showRetryButton={false}
              showEndpointInfo={false}
              title="AI 일정 추가"
              subtitle="원하는 일정을 자연어로 입력하면 초안을 만들고 선택 항목을 바로 반영할 수 있습니다."
              placeholder="예: 다음 주 월요일 오전 10시에 디자인 리뷰 1시간 추가"
              className="embedded ai-add-workspace"
              onApplied={() => setIsAiAddOpen(false)}
              onRequestClose={() => setIsAiAddOpen(false)}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
