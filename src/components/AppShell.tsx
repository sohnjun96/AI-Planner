import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import type { TaskFormInput } from "../models";
import { useAppData } from "../context/AppDataContext";
import { TaskForm } from "./TaskForm";

const NAV_ITEMS = [
  { to: "/dashboard", label: "대시보드" },
  { to: "/tasks", label: "일정 관리" },
  { to: "/projects", label: "프로젝트 관리" },
  { to: "/archive", label: "지난 업무" },
  { to: "/settings", label: "설정" },
];

interface CommandItem {
  id: string;
  label: string;
  keywords: string;
  run: () => void;
}

export function AppShell() {
  const { setting, updateSetting, projects, taskTypes, tasks, createTask, canUndo, undoLastChange, undoDescription } =
    useAppData();
  const navigate = useNavigate();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");

  const commandItems = useMemo<CommandItem[]>(
    () => [
      { id: "go-dashboard", label: "Go: Dashboard", keywords: "dashboard home", run: () => navigate("/dashboard") },
      { id: "go-tasks", label: "Go: Tasks", keywords: "tasks list", run: () => navigate("/tasks") },
      { id: "go-projects", label: "Go: Projects", keywords: "projects", run: () => navigate("/projects") },
      { id: "go-archive", label: "Go: Archive", keywords: "archive history", run: () => navigate("/archive") },
      { id: "go-settings", label: "Go: Settings", keywords: "settings", run: () => navigate("/settings") },
      {
        id: "quick-add",
        label: "Action: Quick Add Task",
        keywords: "new create task",
        run: () => setIsQuickAddOpen(true),
      },
      {
        id: "toggle-show-past",
        label: `Action: ${setting.showPastCompleted ? "Hide" : "Show"} Past Completed`,
        keywords: "toggle past completed",
        run: () => {
          void updateSetting({ showPastCompleted: !setting.showPastCompleted });
        },
      },
      {
        id: "undo-last",
        label: "Action: Undo Last Change",
        keywords: "undo revert",
        run: () => {
          if (!canUndo) {
            return;
          }
          void undoLastChange().catch(() => {});
        },
      },
    ],
    [navigate, setting.showPastCompleted, updateSetting, canUndo, undoLastChange],
  );

  const filteredCommandItems = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return commandItems;
    }
    return commandItems.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(query));
  }, [commandItems, commandQuery]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setIsQuickAddOpen(true);
      }
      if (event.ctrlKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandOpen(true);
      }
      if (event.key === "Escape") {
        setIsQuickAddOpen(false);
        setIsCommandOpen(false);
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

  function handleExecuteCommand(commandItem: CommandItem) {
    commandItem.run();
    setIsCommandOpen(false);
    setCommandQuery("");
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
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
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
              className="btn btn-soft"
              onClick={() => {
                setIsCommandOpen(true);
              }}
              aria-label="Open command palette, shortcut Ctrl+K"
            >
              Command
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

      {isCommandOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsCommandOpen(false);
          }}
        >
          <section
            className="modal-card panel command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>Command Palette</h2>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setIsCommandOpen(false);
                }}
              >
                Close
              </button>
            </header>

            <input
              type="text"
              placeholder="Type a command..."
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              autoFocus
            />

            <ul className="command-list">
              {filteredCommandItems.map((item) => (
                <li key={item.id}>
                  <button type="button" className="command-item" onClick={() => handleExecuteCommand(item)}>
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>

            {filteredCommandItems.length === 0 ? <p className="empty-text">No command found.</p> : null}
          </section>
        </div>
      ) : null}

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
