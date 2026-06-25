import { useEffect, useMemo, useRef, useState } from "react";
import { ColorSelector } from "../components/ColorSelector";
import {
  DEFAULT_AI_CONTEXT_MAX_LENGTH,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  LLM_DEFAULT_MODEL,
  MAX_AI_CONTEXT_MAX_LENGTH,
  MIN_AI_CONTEXT_MAX_LENGTH,
  pickRandomPresetColor,
} from "../constants";
import { useAppData } from "../context/AppDataContext";
import { requestLlmResponse } from "../agent/llmClient";
import { formatDateTime } from "../utils/date";

interface TypeFormState {
  id?: string;
  name: string;
  color: string;
  isActive: boolean;
  isDefault: boolean;
}

function createEmptyTypeForm(): TypeFormState {
  return {
    id: undefined,
    name: "",
    color: pickRandomPresetColor(),
    isActive: true,
    isDefault: false,
  };
}

const TYPE_FORM_AUTOSAVE_DELAY_MS = 700;
type AiConnectionStatus = "idle" | "checking" | "ok" | "error";

interface TaskTypeInputPayload {
  id?: string;
  name: string;
  color: string;
  isActive: boolean;
}

function buildTaskTypeInput(form: TypeFormState): { input?: TaskTypeInputPayload; error?: string } {
  const name = form.name.trim();
  if (!name) {
    return { error: "종류명을 입력해 주세요." };
  }

  return {
    input: {
      id: form.id,
      name,
      color: form.color,
      isActive: form.isActive,
    },
  };
}

function serializeTaskTypeInput(input: TaskTypeInputPayload): string {
  return JSON.stringify({
    id: input.id ?? "",
    name: input.name.trim(),
    color: input.color,
    isActive: input.isActive,
  });
}

export function SettingsPage() {
  const {
    setting,
    updateSetting,
    exportData,
    importData,
    userContext,
    updateUserContextMarkdown,
    resetUserContext,
    taskTypes,
    upsertTaskType,
    deleteTaskType,
    autoBackups,
    createAutoBackup,
    restoreAutoBackup,
    deleteAutoBackup,
    refreshAutoBackups,
  } = useAppData();

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const [isBackupListOpen, setIsBackupListOpen] = useState(false);
  const [userContextDraft, setUserContextDraft] = useState("");
  const [userContextMessage, setUserContextMessage] = useState("");
  const [userContextError, setUserContextError] = useState("");
  const [aiConnectionStatus, setAiConnectionStatus] = useState<AiConnectionStatus>("idle");
  const [aiConnectionMessage, setAiConnectionMessage] = useState("");

  const [typeForm, setTypeForm] = useState<TypeFormState>(() => createEmptyTypeForm());
  const [typeMessage, setTypeMessage] = useState("");
  const [typeError, setTypeError] = useState("");
  const typeAutoSaveSnapshotRef = useRef("");
  const lastTypeIdRef = useRef<string | undefined>(undefined);

  const sortedTypes = useMemo(() => [...taskTypes].sort((a, b) => a.order - b.order), [taskTypes]);
  const aiContextMaxLength = setting.aiContextMaxLength ?? DEFAULT_AI_CONTEXT_MAX_LENGTH;
  const userContextUsedLength = Math.min(userContextDraft.length, aiContextMaxLength);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setUserContextDraft(userContext.markdown);
      setUserContextMessage("");
      setUserContextError("");
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [userContext.markdown, userContext.updatedAt]);

  useEffect(() => {
    void refreshAutoBackups();
  }, [refreshAutoBackups]);

  useEffect(() => {
    if (!isBackupListOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsBackupListOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBackupListOpen]);

  useEffect(() => {
    if (!typeForm.id) {
      typeAutoSaveSnapshotRef.current = "";
      lastTypeIdRef.current = undefined;
      return;
    }

    if (lastTypeIdRef.current !== typeForm.id) {
      const built = buildTaskTypeInput(typeForm);
      typeAutoSaveSnapshotRef.current = built.input ? serializeTaskTypeInput(built.input) : "";
      lastTypeIdRef.current = typeForm.id;
      return;
    }

    const built = buildTaskTypeInput(typeForm);
    if (!built.input) {
      return;
    }

    const snapshot = serializeTaskTypeInput(built.input);
    if (snapshot === typeAutoSaveSnapshotRef.current) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void upsertTaskType(built.input as TaskTypeInputPayload)
        .then(() => {
          typeAutoSaveSnapshotRef.current = snapshot;
          setTypeError("");
          setTypeMessage("자동 저장됨.");
        })
        .catch((saveError) => {
          setTypeError(saveError instanceof Error ? saveError.message : "종류 저장에 실패했습니다.");
        });
    }, TYPE_FORM_AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [typeForm, upsertTaskType]);

  async function handleExport() {
    setError("");
    setMessage("");
    try {
      const content = await exportData();
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `일정관리-백업-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("백업 파일을 내보냈습니다.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "백업 파일 내보내기에 실패했습니다.");
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const content = await file.text();
      await importData(content);
      setMessage("백업 파일을 가져왔습니다.");
      event.target.value = "";
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "백업 파일 가져오기에 실패했습니다.");
    }
  }

  async function handleCreateManualBackup() {
    setBackupError("");
    setBackupMessage("");

    try {
      await createAutoBackup("수동");
      setBackupMessage("자동 백업 저장소에 백업을 추가했습니다.");
    } catch (backupCreateError) {
      setBackupError(backupCreateError instanceof Error ? backupCreateError.message : "백업 생성에 실패했습니다.");
    }
  }

  async function handleRestoreBackup(backupId: string) {
    const shouldRestore = window.confirm("선택한 백업으로 복원할까요? 현재 데이터가 교체됩니다.");
    if (!shouldRestore) {
      return;
    }

    setBackupError("");
    setBackupMessage("");

    try {
      await restoreAutoBackup(backupId);
      setBackupMessage("백업에서 데이터를 복원했습니다.");
    } catch (backupRestoreError) {
      setBackupError(backupRestoreError instanceof Error ? backupRestoreError.message : "백업 복원에 실패했습니다.");
    }
  }

  async function handleDeleteBackup(backupId: string) {
    setBackupError("");
    setBackupMessage("");

    try {
      await deleteAutoBackup(backupId);
      setBackupMessage("백업을 삭제했습니다.");
    } catch (backupDeleteError) {
      setBackupError(backupDeleteError instanceof Error ? backupDeleteError.message : "백업 삭제에 실패했습니다.");
    }
  }

  async function handleSaveUserContext() {
    setUserContextError("");
    setUserContextMessage("");

    try {
      await updateUserContextMarkdown(userContextDraft.slice(0, aiContextMaxLength));
      setUserContextMessage("user.md를 저장했습니다.");
    } catch (contextSaveError) {
      setUserContextError(contextSaveError instanceof Error ? contextSaveError.message : "user.md 저장에 실패했습니다.");
    }
  }

  async function handleResetUserContext() {
    const shouldReset = window.confirm("user.md를 기본값으로 되돌릴까요?");
    if (!shouldReset) {
      return;
    }

    setUserContextError("");
    setUserContextMessage("");

    try {
      await resetUserContext();
      setUserContextMessage("user.md 기본값을 복원했습니다.");
    } catch (contextResetError) {
      setUserContextError(contextResetError instanceof Error ? contextResetError.message : "user.md 초기화에 실패했습니다.");
    }
  }

  async function handleCheckAiConnection() {
    const startedAt = performance.now();
    setAiConnectionStatus("checking");
    setAiConnectionMessage("AI 연결을 확인하는 중입니다.");

    try {
      const response = await requestLlmResponse({
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        model: setting.llmModel ?? LLM_DEFAULT_MODEL,
        apiKey: setting.llmApiKey ?? "",
        messages: [
          {
            role: "system",
            content: "You are a connection test endpoint. Reply with OK only.",
          },
          {
            role: "user",
            content: "연결 확인",
          },
        ],
      });
      const elapsedMs = Math.max(1, Math.round(performance.now() - startedAt));
      const modelName = (setting.llmModel ?? LLM_DEFAULT_MODEL).trim() || LLM_DEFAULT_MODEL;
      setAiConnectionStatus("ok");
      setAiConnectionMessage(`연결 성공 (${modelName}, ${elapsedMs}ms): ${response.slice(0, 80)}`);
    } catch (connectionError) {
      setAiConnectionStatus("error");
      setAiConnectionMessage(connectionError instanceof Error ? connectionError.message : "AI 연결 확인에 실패했습니다.");
    }
  }

  async function handleTypeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTypeError("");
    setTypeMessage("");

    const built = buildTaskTypeInput(typeForm);
    if (!built.input) {
      setTypeError(built.error ?? "종류 입력값이 올바르지 않습니다.");
      return;
    }

    try {
      await upsertTaskType(built.input);
      typeAutoSaveSnapshotRef.current = serializeTaskTypeInput(built.input);
      setTypeMessage(typeForm.id ? "저장됨." : "종류가 생성되었습니다.");

      if (!typeForm.id) {
        setTypeForm(createEmptyTypeForm());
        typeAutoSaveSnapshotRef.current = "";
        lastTypeIdRef.current = undefined;
      }
    } catch (submitError) {
      setTypeError(submitError instanceof Error ? submitError.message : "종류 저장에 실패했습니다.");
    }
  }

  async function handleTypeDelete() {
    if (!typeForm.id) {
      return;
    }

    setTypeError("");
    setTypeMessage("");

    try {
      await deleteTaskType(typeForm.id);
      setTypeMessage("종류가 삭제되었습니다.");
      setTypeForm(createEmptyTypeForm());
      typeAutoSaveSnapshotRef.current = "";
      lastTypeIdRef.current = undefined;
    } catch (deleteError) {
      setTypeError(deleteError instanceof Error ? deleteError.message : "종류 삭제에 실패했습니다.");
    }
  }

  function openBackupList() {
    setIsBackupListOpen(true);
    void refreshAutoBackups();
  }

  function startCreateType() {
    setTypeError("");
    setTypeMessage("");
    setTypeForm(createEmptyTypeForm());
    typeAutoSaveSnapshotRef.current = "";
    lastTypeIdRef.current = undefined;
  }

  function handleSelectType(type: {
    id: string;
    name: string;
    color: string;
    isActive: boolean;
    isDefault: boolean;
  }) {
    setTypeError("");
    setTypeMessage("");
    setTypeForm({
      id: type.id,
      name: type.name,
      color: type.color,
      isActive: type.isActive,
      isDefault: type.isDefault,
    });
  }

  return (
    <div className="settings-workspace">
      <section className="settings-hero">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h2>설정</h2>
          <p className="description-text">캘린더 표시, 알림, 백업, AI 연결과 일정 종류를 한 화면에서 조정합니다.</p>
        </div>
        <div className="settings-hero-actions">
          <button className="btn btn-primary" type="button" onClick={() => void handleExport()}>
            JSON 내보내기
          </button>
          <label className="btn btn-soft file-upload">
            JSON 가져오기
            <input type="file" accept=".json,application/json" onChange={handleImport} />
          </label>
        </div>
      </section>

      <section className="settings-overview-grid" aria-label="설정 요약">
        <article className="settings-summary-card">
          <span>주 시작</span>
          <strong>{setting.weekStartsOn === "mon" ? "월요일" : "일요일"}</strong>
        </article>
        <article className="settings-summary-card">
          <span>시간 표시</span>
          <strong>{setting.timeFormat === "24h" ? "24시간제" : "12시간제"}</strong>
        </article>
        <article className="settings-summary-card">
          <span>알림</span>
          <strong>{setting.notificationsEnabled ? `${setting.notifyBeforeMinutes ?? 30}분 전` : "꺼짐"}</strong>
        </article>
        <article className="settings-summary-card">
          <span>백업</span>
          <strong>{setting.autoBackupEnabled ? `${autoBackups.length}개 보관` : "수동"}</strong>
        </article>
        <article className="settings-summary-card">
          <span>AI 컨텍스트</span>
          <strong>{userContextUsedLength} / {aiContextMaxLength}자</strong>
        </article>
      </section>

      <div className="settings-main-grid">
        <section className="settings-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">GENERAL</p>
              <h3>기본 환경</h3>
            </div>
          </header>

          <div className="form-grid two-col">
            <label>
              주 시작 요일
              <select
                value={setting.weekStartsOn}
                onChange={(event) => {
                  void updateSetting({ weekStartsOn: event.target.value as "sun" | "mon" });
                }}
              >
                <option value="mon">월요일</option>
                <option value="sun">일요일</option>
              </select>
            </label>

            <label>
              시간 표시 형식
              <select
                value={setting.timeFormat}
                onChange={(event) => {
                  void updateSetting({ timeFormat: event.target.value as "24h" | "12h" });
                }}
              >
                <option value="24h">24시간제</option>
                <option value="12h">12시간제</option>
              </select>
            </label>
          </div>

          <label className="checkbox-inline settings-toggle-row">
            <input
              type="checkbox"
              checked={setting.showPastCompleted}
              onChange={(event) => {
                void updateSetting({ showPastCompleted: event.target.checked });
              }}
            />
            지난 완료 업무를 기본으로 표시
          </label>
        </section>

        <section className="settings-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">AI</p>
              <h3>AI 연결</h3>
            </div>
            <button
              type="button"
              className="btn btn-soft"
              onClick={() => {
                void handleCheckAiConnection();
              }}
              disabled={aiConnectionStatus === "checking"}
            >
              {aiConnectionStatus === "checking" ? "확인 중" : "연결 확인"}
            </button>
          </header>

          <div className="form-grid two-col">
            <label>
              Endpoint 주소
              <input
                type="url"
                value={setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL}
                onChange={(event) => {
                  void updateSetting({ llmEndpoint: event.target.value });
                }}
                placeholder={DEFAULT_LLM_CHAT_COMPLETIONS_URL}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label>
              LLM 모델명
              <input
                type="text"
                value={setting.llmModel ?? LLM_DEFAULT_MODEL}
                onChange={(event) => {
                  void updateSetting({ llmModel: event.target.value });
                }}
                placeholder={LLM_DEFAULT_MODEL}
              />
            </label>

            <label>
              LLM API 키
              <input
                type="password"
                value={setting.llmApiKey ?? ""}
                onChange={(event) => {
                  void updateSetting({ llmApiKey: event.target.value });
                }}
                placeholder="API 키"
                autoComplete="off"
              />
            </label>
          </div>

          <p className="description-text">Endpoint, 모델명, API Key는 입력 즉시 저장됩니다.</p>
          {aiConnectionMessage ? (
            <p className={`endpoint-status ${aiConnectionStatus === "idle" ? "" : aiConnectionStatus}`} role="status" aria-live="polite">
              {aiConnectionMessage}
            </p>
          ) : null}
        </section>

        <section className="settings-card settings-context-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">USER CONTEXT</p>
              <h3>user.md</h3>
            </div>
            <small>{userContextUsedLength} / {aiContextMaxLength}자</small>
          </header>

          <div className="form-grid two-col">
            <label>
              AI 컨텍스트 최대 길이
              <input
                type="text"
                inputMode="numeric"
                value={String(aiContextMaxLength)}
                onChange={(event) => {
                  const next = Number(event.target.value.replace(/[^0-9]/g, ""));
                  void updateSetting({ aiContextMaxLength: Number.isFinite(next) ? next : DEFAULT_AI_CONTEXT_MAX_LENGTH });
                }}
              />
            </label>

            <label>
              권장 범위
              <input
                type="text"
                value={`${MIN_AI_CONTEXT_MAX_LENGTH} - ${MAX_AI_CONTEXT_MAX_LENGTH}자`}
                readOnly
              />
            </label>
          </div>

          <label className="user-context-editor">
            사용자 컨텍스트
            <textarea
              value={userContextDraft}
              maxLength={aiContextMaxLength}
              onChange={(event) => setUserContextDraft(event.target.value)}
              rows={12}
              spellCheck={false}
            />
          </label>

          <div className="settings-inline-note">
            <span>AI 일정 추가 시 이 내용이 개인 규칙으로 전달됩니다. 현재 입력이 더 구체적이면 현재 입력을 우선합니다.</span>
          </div>

          <div className="button-row">
            <button className="btn btn-primary" type="button" onClick={() => void handleSaveUserContext()}>
              user.md 저장
            </button>
            <button className="btn btn-soft" type="button" onClick={() => void handleResetUserContext()}>
              기본값 복원
            </button>
          </div>

          {userContextMessage ? <p className="success-text">{userContextMessage}</p> : null}
          {userContextError ? <p className="error-text">{userContextError}</p> : null}
        </section>

        <section className="settings-card settings-backup-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">NOTIFY & BACKUP</p>
              <h3>알림과 백업</h3>
            </div>
          </header>

          <div className="settings-actions-grid">
            <label className="checkbox-inline settings-toggle-row">
              <input
                type="checkbox"
                checked={Boolean(setting.notificationsEnabled)}
                onChange={(event) => {
                  void updateSetting({ notificationsEnabled: event.target.checked });
                }}
              />
              일정 알림 사용
            </label>

            <label>
              알림 사전 시간(분)
              <input
                type="text"
                inputMode="numeric"
                value={String(setting.notifyBeforeMinutes ?? 30)}
                onChange={(event) => {
                  const next = Number(event.target.value.replace(/[^0-9]/g, ""));
                  void updateSetting({ notifyBeforeMinutes: Number.isFinite(next) ? next : 0 });
                }}
              />
            </label>

            <label className="checkbox-inline settings-toggle-row">
              <input
                type="checkbox"
                checked={Boolean(setting.autoBackupEnabled)}
                onChange={(event) => {
                  void updateSetting({ autoBackupEnabled: event.target.checked });
                }}
              />
              자동 백업 사용
            </label>

            <label>
              자동 백업 주기(분)
              <input
                type="text"
                inputMode="numeric"
                value={String(setting.autoBackupIntervalMinutes ?? 360)}
                onChange={(event) => {
                  const next = Number(event.target.value.replace(/[^0-9]/g, ""));
                  void updateSetting({ autoBackupIntervalMinutes: Number.isFinite(next) ? next : 15 });
                }}
              />
            </label>
          </div>

          <div className="settings-backup-actions">
            <button className="btn btn-primary" type="button" onClick={() => void handleCreateManualBackup()}>
              지금 백업 생성
            </button>
            <button className="btn btn-soft" type="button" onClick={openBackupList}>
              자동 백업 목록 보기
            </button>
          </div>

          {backupMessage ? <p className="success-text">{backupMessage}</p> : null}
          {backupError ? <p className="error-text">{backupError}</p> : null}
          {message ? <p className="success-text">{message}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          <div className="settings-backup-list-summary">
            <div>
              <strong>자동 백업 목록</strong>
              <p className="description-text">
                {autoBackups.length > 0
                  ? `저장된 백업 ${autoBackups.length}개. 목록 보기에서 복원하거나 삭제할 수 있습니다.`
                  : "저장된 자동 백업이 없습니다."}
              </p>
            </div>
            <button className="btn btn-outline" type="button" onClick={openBackupList}>
              목록 보기
            </button>
          </div>
        </section>

        <section className="settings-card settings-type-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">TYPES</p>
              <h3>일정 종류</h3>
            </div>
            <div className="settings-type-header-actions">
              <small>{sortedTypes.length}개</small>
              <button className="btn btn-primary" type="button" onClick={startCreateType}>
                새 종류 추가
              </button>
            </div>
          </header>

          <div className="settings-type-layout">
            <ul className="entity-list">
              {sortedTypes.map((type) => (
                <li
                  key={type.id}
                  className={`entity-item ${typeForm.id === type.id ? "selected" : ""}`}
                  onClick={() => handleSelectType(type)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${type.name} 종류 선택`}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectType(type);
                    }
                  }}
                >
                  <span className="color-dot" style={{ backgroundColor: type.color }} />
                  <strong>{type.name}</strong>
                  <small>{type.isDefault ? "기본" : "사용자"}</small>
                </li>
              ))}
            </ul>

            <form className="task-form" onSubmit={handleTypeSubmit}>
              <div className="type-form-heading">
                <div>
                  <h3>{typeForm.id ? "종류 수정" : "새 종류 추가"}</h3>
                  <p className="description-text">
                    {typeForm.id ? "선택한 종류는 입력 후 저장하거나 자동 저장됩니다." : "종류명과 색상을 정한 뒤 생성하세요."}
                  </p>
                </div>
              </div>

              <label>
                종류명
                <input
                  type="text"
                  value={typeForm.name}
                  onChange={(event) => setTypeForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="예: 회의, 검토, 제출"
                  required
                />
              </label>

              <label>
                색상
                <ColorSelector
                  value={typeForm.color}
                  onChange={(nextColor) => {
                    setTypeForm((prev) => ({ ...prev, color: nextColor }));
                  }}
                />
              </label>

              <label className="checkbox-inline settings-toggle-row">
                <input
                  type="checkbox"
                  checked={typeForm.isActive}
                  onChange={(event) => setTypeForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                />
                사용
              </label>

              <div className="button-row">
                <button className="btn btn-primary" type="submit">
                  {typeForm.id ? "저장" : "종류 생성"}
                </button>

                {typeForm.id && !typeForm.isDefault ? (
                  <button className="btn btn-danger" type="button" onClick={() => void handleTypeDelete()}>
                    삭제
                  </button>
                ) : null}

                <button
                  className="btn btn-soft"
                  type="button"
                  onClick={startCreateType}
                >
                  {typeForm.id ? "새 종류 입력" : "초기화"}
                </button>
              </div>

              {typeMessage ? <p className="success-text">{typeMessage}</p> : null}
              {typeError ? <p className="error-text">{typeError}</p> : null}
            </form>
          </div>
        </section>
      </div>

      {isBackupListOpen ? (
        <div className="modal-backdrop" onClick={() => setIsBackupListOpen(false)}>
          <section
            className="modal-card panel settings-backup-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="자동 백업 목록"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <div>
                <p className="eyebrow">BACKUPS</p>
                <h2>자동 백업 목록</h2>
                <small>필요한 백업을 선택해 복원하거나 오래된 백업을 삭제하세요.</small>
              </div>
              <div className="button-row compact">
                <button className="btn btn-soft" type="button" onClick={() => void refreshAutoBackups()}>
                  새로고침
                </button>
                <button className="btn btn-soft" type="button" onClick={() => setIsBackupListOpen(false)}>
                  닫기
                </button>
              </div>
            </header>

            {autoBackups.length === 0 ? (
              <div className="empty-state compact">
                <p>저장된 자동 백업이 없습니다.</p>
              </div>
            ) : (
              <ul className="backup-list settings-backup-modal-list">
                {autoBackups.map((backup) => (
                  <li key={backup.id} className="backup-item">
                    <div>
                      <strong>{formatDateTime(backup.createdAt, setting.timeFormat)}</strong>
                      <p className="description-text">사유: {backup.reason} / 크기: {(backup.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <div className="button-row compact">
                      <button
                        className="btn btn-soft"
                        type="button"
                        onClick={() => {
                          void handleRestoreBackup(backup.id);
                        }}
                      >
                        복원
                      </button>
                      <button
                        className="btn btn-danger"
                        type="button"
                        onClick={() => {
                          void handleDeleteBackup(backup.id);
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
