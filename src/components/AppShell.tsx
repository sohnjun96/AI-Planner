import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { TaskForm } from "./TaskForm";
import { useAppData } from "../context/AppDataContext";
import type { TaskFormInput } from "../models";

const NAV_ITEMS = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/tasks", label: "일정 관리" },
  { to: "/projects", label: "프로젝트 관리" },
  { to: "/archive", label: "지난 업무" },
  { to: "/settings", label: "설정" },
];

export function AppShell() {
  const { setting, updateSetting, projects, taskTypes, tasks, createTask, canUndo, undoLastChange, undoDescription } = useAppData();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setIsQuickAddOpen(true);
      }

      if (event.key === "Escape") {
        setIsQuickAddOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  async function handleQuickCreate(input: TaskFormInput) {
    await createTask(input);
    setIsQuickAddOpen(false);
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>

      <aside className="sidebar" aria-label="기본 메뉴">
        <h1 className="brand">업무 일정관리</h1>
        <nav className="sidebar-nav" aria-label="페이지 이동">
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
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-actions">
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={setting.showPastCompleted}
                onChange={(event) => {
                  void updateSetting({ showPastCompleted: event.target.checked });
                }}
              />
              지난 완료 업무 보기
            </label>

            <button
              type="button"
              className="btn btn-soft"
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
                setIsQuickAddOpen(true);
              }}
              aria-label="빠른 일정 추가, 단축키 Ctrl+Shift+N"
            >
              빠른 일정 추가
            </button>
          </div>
        </header>

        <main className="page-content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {isQuickAddOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsQuickAddOpen(false);
          }}
        >
          <section
            className="modal-card panel"
            role="dialog"
            aria-modal="true"
            aria-label="빠른 일정 추가"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>빠른 일정 추가</h2>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setIsQuickAddOpen(false);
                }}
              >
                닫기
              </button>
            </header>

            <TaskForm
              projects={projects}
              taskTypes={taskTypes}
              allTasks={tasks}
              timeFormat={setting.timeFormat}
              onSubmit={handleQuickCreate}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
