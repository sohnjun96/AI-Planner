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
      { id: "go-dashboard", label: "이동: 대시보드", keywords: "대시보드 홈 dashboard", run: () => navigate("/dashboard") },
      { id: "go-tasks", label: "이동: 일정 관리", keywords: "일정 목록 tasks", run: () => navigate("/tasks") },
      { id: "go-projects", label: "이동: 프로젝트", keywords: "프로젝트 projects", run: () => navigate("/projects") },
      { id: "go-archive", label: "이동: 지난 업무", keywords: "아카이브 archive", run: () => navigate("/archive") },
      { id: "go-settings", label: "이동: 설정", keywords: "설정 settings", run: () => navigate("/settings") },
      {
        id: "quick-add",
        label: "실행: 빠른 일정 추가",
        keywords: "새 일정 추가 quick add",
        run: () => setIsQuickAddOpen(true),
      },
      {
        id: "toggle-show-past",
        label: `실행: 지난 완료 일정 ${setting.showPastCompleted ? "숨기기" : "보기"}`,
        keywords: "지난 완료 일정 토글",
        run: () => {
          void updateSetting({ showPastCompleted: !setting.showPastCompleted });
        },
      },
      {
        id: "undo-last",
        label: "실행: 마지막 작업 되돌리기",
        keywords: "되돌리기 undo",
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
              지난 완료 일정 보기
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
              aria-label="명령 팔레트 열기, 단축키 Ctrl+K"
            >
              명령
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
            aria-label="명령 팔레트"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <h2>명령 팔레트</h2>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => {
                  setIsCommandOpen(false);
                }}
              >
                닫기
              </button>
            </header>

            <input
              type="text"
              placeholder="명령을 입력하세요..."
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

            {filteredCommandItems.length === 0 ? <p className="empty-text">일치하는 명령이 없습니다.</p> : null}
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
