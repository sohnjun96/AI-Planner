import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AppDataProvider, useAppData } from "./context/AppDataContext";
import { ArchivePage } from "./pages/ArchivePage";
import { AiAssistantPage } from "./pages/AiAssistantPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";

function RoutedApp() {
  const { isReady } = useAppData();

  if (!isReady) {
    return <div className="loading-screen">초기 데이터를 불러오는 중입니다...</div>;
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/ai" element={<AiAssistantPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/types" element={<Navigate to="/settings" replace />} />
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
