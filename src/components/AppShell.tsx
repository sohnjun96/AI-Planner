import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { DEFAULT_PROJECT_ID } from "../constants";
import { useAppData } from "../context/AppDataContext";
import { deriveNoteTitle } from "../utils/noteTitle";
import { AiAssistantWorkspace } from "./AiAssistantWorkspace";
import { AskDataModal } from "./AskDataModal";
import { HelpModal } from "./HelpModal";
import { NoteQuickAddModal } from "./NoteQuickAddModal";

const NAV_ITEMS = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/notes", label: "노트" },
  { to: "/projects", label: "프로젝트" },
  { to: "/archive", label: "보관함" },
  { to: "/settings", label: "설정" },
];

type AiScheduleOpenDetail = {
  initialDraft?: string;
};

export function AppShell() {
  const { canUndo, undoLastChange, undoDescription, projects, createNote } = useAppData();
  const navigate = useNavigate();
  const [isAiAddOpen, setIsAiAddOpen] = useState(false);
  const [aiInitialDraft, setAiInitialDraft] = useState("");
  const [isNoteAddOpen, setIsNoteAddOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAskOpen, setIsAskOpen] = useState(false);

  const activeProjectId = useMemo(
    () => projects.find((project) => project.isActive)?.id ?? projects[0]?.id ?? DEFAULT_PROJECT_ID,
    [projects],
  );

  async function handleQuickCreateNote(title: string, content: string) {
    const id = await createNote({
      title: title.trim() || deriveNoteTitle(content) || "새 노트",
      content,
      projectId: activeProjectId,
      subcategoryId: undefined,
      tags: [],
      status: "draft",
      isPinned: false,
    });
    setIsNoteAddOpen(false);
    navigate("/notes");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("ai-planner:focus-note", { detail: { noteId: id } }));
    }, 80);
  }

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

      if (event.key === "?") {
        event.preventDefault();
        setIsHelpOpen(true);
        return;
      }

      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setAiInitialDraft("");
        setIsAiAddOpen(true);
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setAiInitialDraft("");
        setIsAiAddOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handleOpenAiSchedule = (event: Event) => {
      const detail = (event as CustomEvent<AiScheduleOpenDetail>).detail;
      setAiInitialDraft(detail?.initialDraft ?? "");
      setIsAiAddOpen(true);
    };

    window.addEventListener("ai-planner:open-ai-schedule", handleOpenAiSchedule);
    return () => {
      window.removeEventListener("ai-planner:open-ai-schedule", handleOpenAiSchedule);
    };
  }, []);

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

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setAiInitialDraft("");
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
                <small>일정 추가·수정·삭제를 자연어로 말해보세요.</small>
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
              showHeader={false}
              hideInitialResult
              showRetryButton={false}
              showEndpointInfo={false}
              title="AI 일정 추가"
              inputLabel=""
              placeholder="예: 다음 주 월요일 오전 10시에 디자인 리뷰 1시간 추가"
              className="embedded ai-add-workspace"
              initialDraft={aiInitialDraft}
              onApplied={() => setIsAiAddOpen(false)}
              onRequestClose={() => setIsAiAddOpen(false)}
            />
          </section>
        </div>
      ) : null}

      {isNoteAddOpen ? (
        <NoteQuickAddModal onCreate={handleQuickCreateNote} onClose={() => setIsNoteAddOpen(false)} />
      ) : null}

      {isHelpOpen ? <HelpModal onClose={() => setIsHelpOpen(false)} /> : null}

      {isAskOpen ? <AskDataModal onClose={() => setIsAskOpen(false)} /> : null}
    </div>
  );
}
