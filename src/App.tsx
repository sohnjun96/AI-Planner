import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AppDataProvider, useAppData } from "./context/AppDataContext";
import { ArchivePage } from "./pages/ArchivePage";
import { DashboardPage } from "./pages/DashboardPage";
import { NotesPage } from "./pages/NotesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";

function RoutedApp() {
  const { isReady, bootstrapError, retryBootstrap } = useAppData();

  if (bootstrapError) {
    return (
      <main className="loading-screen" role="alert" aria-live="assertive">
        <section className="panel" aria-labelledby="storage-error-title">
          <p className="eyebrow">DATA RECOVERY</p>
          <h1 id="storage-error-title">저장된 데이터를 열지 못했습니다</h1>
          <p className="error-text">{bootstrapError}</p>
          <p className="description-text">
            이 화면에서는 기존 데이터를 삭제하거나 초기화하지 않습니다. 브라우저 저장공간 권한과 남은 용량을 확인한 뒤 다시
            시도해 주세요. 문제가 계속되면 앱을 새로고침한 후 최근 JSON 또는 자동 백업으로 복원할 수 있습니다.
          </p>
          <div className="button-row">
            <button className="btn btn-primary" type="button" onClick={() => void retryBootstrap()}>
              다시 시도
            </button>
            <button className="btn btn-outline" type="button" onClick={() => window.location.reload()}>
              앱 새로고침
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!isReady) {
    return (
      <div className="loading-screen" role="status" aria-live="polite">
        초기 데이터를 불러오는 중입니다...
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tasks" element={<Navigate to="/dashboard" replace />} />
          <Route path="/ai" element={<Navigate to="/dashboard" replace />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/types" element={<Navigate to="/settings?section=general" replace />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default function App() {
  return (
    <AppDataProvider>
      <RoutedApp />
    </AppDataProvider>
  );
}
