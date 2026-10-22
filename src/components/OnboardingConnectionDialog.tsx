import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { generationOptionsFromSetting, listLlmModels, requestLlmResponse } from "../agent/llmClient";
import {
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  isValidLlmModelId,
  LLM_DEFAULT_MODEL,
  LLM_MAX_API_KEY_LENGTH,
  LLM_MAX_MODEL_ID_LENGTH,
} from "../constants";
import { useAppData } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ModalBackdrop } from "./ModalBackdrop";
import "./OnboardingConnectionDialog.css";

interface OnboardingConnectionDialogProps {
  onConnected: () => void;
  onSkip: () => void;
}

type ConnectionStatus = "idle" | "checking" | "saving" | "ok" | "error";

export function OnboardingConnectionDialog({ onConnected, onSkip }: OnboardingConnectionDialogProps) {
  const { setting, updateSetting } = useAppData();
  const [apiKey, setApiKey] = useState(setting.llmApiKey ?? "");
  const [model, setModel] = useState(setting.llmModel || LLM_DEFAULT_MODEL);
  const [rememberKey, setRememberKey] = useState(setting.rememberLlmApiKey === true);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelMessage, setModelMessage] = useState("");
  const [modelError, setModelError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const keyHelpId = useId();
  const modelListId = useId();
  const busy = status === "checking" || status === "saving" || isLoadingModels;

  function requestSkip() {
    if (status === "saving") return;
    abortRef.current?.abort();
    onSkip();
  }

  const dialogRef = useDialogFocus<HTMLElement>({
    isOpen: true,
    onClose: requestSkip,
    initialFocusRef: keyInputRef,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  function resetConnection() {
    setStatus("idle");
    setMessage("");
  }

  function validateKey(): string | undefined {
    const value = apiKey.trim();
    if (!value) return "LLM API 키를 입력해 주세요.";
    if (apiKey.length > LLM_MAX_API_KEY_LENGTH || /[\r\n]/.test(apiKey)) {
      return "API 키에 줄바꿈이 없는지 확인해 주세요.";
    }
    return undefined;
  }

  async function loadModels() {
    if (abortRef.current) return;
    const keyError = validateKey();
    if (keyError) {
      setStatus("error");
      setMessage(keyError);
      keyInputRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoadingModels(true);
    setModelError(false);
    setModelMessage("사용 가능한 모델을 불러오는 중입니다.");
    try {
      const result = await listLlmModels({
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        apiKey: apiKey.trim(),
        signal: controller.signal,
      });
      if (controller.signal.aborted || !mountedRef.current) return;
      setModels(result);
      setModelMessage(result.length ? "목록에서 모델을 선택하거나 모델명을 직접 입력해 주세요." : "조회된 모델이 없습니다. 모델명을 직접 입력할 수 있습니다.");
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setModels([]);
      setModelError(true);
      setModelMessage(`${error instanceof Error ? error.message : "모델 목록을 불러오지 못했습니다."} 모델명을 직접 입력해 연결을 확인할 수 있습니다.`);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setIsLoadingModels(false);
    }
  }

  async function checkConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (abortRef.current || status === "saving") return;
    const keyError = validateKey();
    const normalizedModel = model.trim() || LLM_DEFAULT_MODEL;
    if (keyError || !isValidLlmModelId(normalizedModel)) {
      setStatus("error");
      setMessage(keyError ?? "올바른 LLM 모델명을 입력해 주세요.");
      if (keyError) keyInputRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("checking");
    setMessage("AI 연결을 확인하는 중입니다.");
    try {
      // 설정 화면과 동일하게 실제 Chat 요청으로 키와 모델을 함께 검증한다.
      await requestLlmResponse({
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        apiKey: apiKey.trim(),
        model: normalizedModel,
        generationOptions: generationOptionsFromSetting(setting),
        signal: controller.signal,
        messages: [
          { role: "system", content: "You are a connection test endpoint. Reply with OK only." },
          { role: "user", content: "연결 확인" },
        ],
      });
      if (controller.signal.aborted || !mountedRef.current) return;
      setStatus("saving");
      setMessage("연결되었습니다. 연결 설정을 저장하는 중입니다.");
      await updateSetting({ llmApiKey: apiKey.trim(), rememberLlmApiKey: rememberKey, llmModel: normalizedModel });
      if (controller.signal.aborted || !mountedRef.current) return;
      setModel(normalizedModel);
      setStatus("ok");
      setMessage("연결을 확인했습니다. 다음 단계로 진행해 주세요.");
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "연결을 확인하지 못했습니다. API 키와 모델명을 확인해 주세요.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <ModalBackdrop className="modal-backdrop onboarding-connection-backdrop" onRequestClose={requestSkip}>
      <section
        ref={dialogRef}
        id="onboarding-connection-dialog"
        className="modal-card onboarding-connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex={-1}
      >
        <header className="onboarding-connection-header">
          <span className="onboarding-connection-step">시작 안내 · 1 / 3</span>
          <button type="button" className="btn btn-soft" onClick={requestSkip} disabled={status === "saving"} aria-label="시작 안내 닫기">닫기</button>
        </header>
        <h2 id={titleId}>AI와 연결해 주세요</h2>
        <p id={descriptionId} className="onboarding-connection-description">LLM API 키를 입력하면 AI가 일정 입력과 프로젝트 분류를 도와줍니다. 이 창에서 연결까지 확인할 수 있어요.</p>
        <form onSubmit={(event) => void checkConnection(event)}>
          <label className="onboarding-connection-field">
            <span>LLM API 키</span>
            <input
              ref={keyInputRef}
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.currentTarget.value);
                setModels([]);
                setModelMessage("");
                resetConnection();
              }}
              maxLength={LLM_MAX_API_KEY_LENGTH}
              placeholder="발급받은 API 키를 입력하세요"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              aria-describedby={keyHelpId}
            />
          </label>
          <label className="checkbox-inline onboarding-connection-remember">
            <input type="checkbox" checked={rememberKey} disabled={busy} onChange={(event) => { setRememberKey(event.currentTarget.checked); resetConnection(); }} />
            이 브라우저에서 API 키 기억하기
          </label>
          <p id={keyHelpId} className="onboarding-connection-help">기억한 키는 브라우저의 전용 저장 항목에 보관하며 데이터 백업에는 포함되지 않습니다. 공용 PC에서는 체크를 해제해 주세요.</p>
          <details className="onboarding-connection-model">
            <summary>연결할 모델 확인 · {model || LLM_DEFAULT_MODEL}</summary>
            <div className="onboarding-connection-model-content">
              <label className="onboarding-connection-field">
                <span>LLM 모델명</span>
                <input type="text" value={model} maxLength={LLM_MAX_MODEL_ID_LENGTH} disabled={busy} list={models.length ? modelListId : undefined} autoComplete="off" spellCheck={false} onChange={(event) => { setModel(event.currentTarget.value); resetConnection(); }} />
              </label>
              {models.length ? <datalist id={modelListId}>{models.map((value) => <option key={value} value={value} />)}</datalist> : null}
              <button type="button" className="btn btn-soft" onClick={() => void loadModels()} disabled={busy}>{isLoadingModels ? "불러오는 중" : "모델 목록 불러오기"}</button>
              {modelMessage ? <p className={`onboarding-connection-help${modelError ? " error-text" : ""}`} role={modelError ? "alert" : "status"}>{modelMessage}</p> : null}
              <p className="onboarding-connection-help onboarding-connection-endpoint">서버 주소: {setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL}</p>
            </div>
          </details>
          {message ? <p className={`onboarding-connection-status is-${status}`} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
          <div className="onboarding-connection-actions">
            <button type="button" className="btn btn-soft" onClick={requestSkip} disabled={status === "saving"}>나중에 하기</button>
            {status === "ok" ? (
              <button type="button" className="btn btn-primary" onClick={onConnected}>다음 단계로</button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={busy}>{status === "checking" ? "연결 확인 중…" : status === "saving" ? "저장 중…" : "연결 확인"}</button>
            )}
          </div>
        </form>
      </section>
    </ModalBackdrop>
  );
}
