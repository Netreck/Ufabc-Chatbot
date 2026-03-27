import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";

function SidebarIcon({ d, children }: { d?: string; children?: React.ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <>
      <div className="bg-grain" />
      <div className="bg-glow bg-glow--top" />
      <div className="bg-glow bg-glow--bottom" />

      <div className="app-shell">
        <nav className="sidebar">
          <div className="sidebar__brand">
            <span className="sidebar__logo">U</span>
          </div>
          <div className="sidebar__nav">
            <NavLink
              to="/ingestion"
              className={({ isActive }) =>
                `sidebar__btn ${isActive ? "active" : ""}`
              }
              title="Ingestion"
            >
              <SidebarIcon>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </SidebarIcon>
              <span className="sidebar__label">Ingest</span>
            </NavLink>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `sidebar__btn ${isActive ? "active" : ""}`
              }
              title="FileSystem"
            >
              <SidebarIcon d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <span className="sidebar__label">Files</span>
            </NavLink>
            <NavLink
              to="/approval"
              className={({ isActive }) =>
                `sidebar__btn ${isActive ? "active" : ""}`
              }
              title="Approval Queue"
            >
              <SidebarIcon>
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </SidebarIcon>
              <span className="sidebar__label">Review</span>
            </NavLink>
            <NavLink
              to="/analytics"
              className={({ isActive }) =>
                `sidebar__btn ${isActive ? "active" : ""}`
              }
              title="Analytics"
            >
              <SidebarIcon>
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </SidebarIcon>
              <span className="sidebar__label">Analytics</span>
            </NavLink>
          </div>
          <div className="sidebar__footer">
            <button
              className="sidebar__btn"
              onClick={toggle}
              title="Toggle theme"
            >
              {theme === "dark" ? (
                <SidebarIcon d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              ) : (
                <SidebarIcon>
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                </SidebarIcon>
              )}
              <span className="sidebar__label">Theme</span>
            </button>
            {user && (
              <button
                className="sidebar__btn"
                onClick={logout}
                title="Logout"
              >
                <SidebarIcon>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </SidebarIcon>
                <span className="sidebar__label">Logout</span>
              </button>
            )}
            <div
              className="sidebar__status"
              id="live-indicator"
              title="Connection status"
            >
              <span className="pulse-dot" />
            </div>
          </div>
        </nav>

        <main className="main-area">
          <Outlet />
        </main>
      </div>
    </>
  );
}
