import { AiAssistantWorkspace } from "../components/AiAssistantWorkspace";
import { AppDataProvider, useAppData } from "../context/AppDataContext";

interface ChromeTabsApi {
  create: (options: { url: string }) => void;
}

interface ChromeRuntimeApi {
  getURL: (path: string) => string;
}

interface ChromeApi {
  runtime?: ChromeRuntimeApi;
  tabs?: ChromeTabsApi;
}

function openFullPage() {
  const chromeApi = (globalThis as { chrome?: ChromeApi }).chrome;
  const url = chromeApi?.runtime?.getURL("index.html#/dashboard") ?? "./index.html#/dashboard";

  if (chromeApi?.tabs?.create) {
    chromeApi.tabs.create({ url });
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function PopupContent() {
  const { isReady } = useAppData();

  if (!isReady) {
    return <div className="popup-loading">초기 데이터를 불러오는 중입니다...</div>;
  }

  return (
    <div className="popup-app">
      <header className="popup-header">
        <div>
          <p className="eyebrow">PLANAI</p>
          <h1>빠른 AI 등록</h1>
        </div>
        <button type="button" className="btn btn-outline" onClick={openFullPage}>
          전체 앱
        </button>
      </header>

      <AiAssistantWorkspace
        compact
        directApply
        showEndpointInfo={false}
        title="AI에게 바로 입력"
        subtitle="초안을 만든 뒤 선택 항목을 이 팝업에서 바로 등록합니다."
        placeholder="예: 오늘 오후 4시에 회의 일정 추가해줘."
        className="popup-ai"
      />
    </div>
  );
}

export function PopupApp() {
  return (
    <AppDataProvider>
      <PopupContent />
    </AppDataProvider>
  );
}
