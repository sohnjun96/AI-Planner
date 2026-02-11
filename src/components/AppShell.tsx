import { NavLink, Outlet } from "react-router-dom";
import { useAppData } from "../context/AppDataContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "\uB300\uC2DC\uBCF4\uB4DC" },
  { to: "/tasks", label: "\uC77C\uC815 \uAD00\uB9AC" },
  { to: "/ai", label: "AI \uB3C4\uC6B0\uBBF8" },
  { to: "/projects", label: "\uD504\uB85C\uC81D\uD2B8 \uAD00\uB9AC" },
  { to: "/archive", label: "\uC9C0\uB09C \uC5C5\uBB34" },
  { to: "/settings", label: "\uC124\uC815" },
];

export function AppShell() {
  const { setting, updateSetting } = useAppData();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1 className="brand">{"\uC5C5\uBB34 \uC77C\uC815\uAD00\uB9AC"}</h1>
        <nav className="sidebar-nav">
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
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={setting.showPastCompleted}
              onChange={(event) => {
                void updateSetting({ showPastCompleted: event.target.checked });
              }}
            />
            {"\uC9C0\uB09C \uC644\uB8CC \uC5C5\uBB34 \uBCF4\uAE30"}
          </label>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
