import { useEffect, useMemo, useRef, useState } from "react";
import { ColorSelector } from "../components/ColorSelector";
import { LLM_CHAT_COMPLETIONS_URL, LLM_DEFAULT_MODEL, pickRandomPresetColor } from "../constants";
import { useAppData } from "../context/AppDataContext";
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

  const [typeForm, setTypeForm] = useState<TypeFormState>(() => createEmptyTypeForm());
  const [typeMessage, setTypeMessage] = useState("");
  const [typeError, setTypeError] = useState("");
  const typeAutoSaveSnapshotRef = useRef("");
  const lastTypeIdRef = useRef<string | undefined>(undefined);

  const sortedTypes = useMemo(() => [...taskTypes].sort((a, b) => a.order - b.order), [taskTypes]);

  useEffect(() => {
    void refreshAutoBackups();
  }, [refreshAutoBackups]);

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
    <div className="settings-layout">
      <section className="panel settings-panel">
        <header className="panel-header">
          <h2>일반 설정</h2>
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

        <label className="checkbox-inline">
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

      <section className="panel settings-panel">
        <header className="panel-header">
          <h2>알림 및 백업</h2>
        </header>

        <div className="form-grid two-col">
          <label className="checkbox-inline">
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
        </div>

        <div className="form-grid two-col">
          <label className="checkbox-inline">
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

        <div className="button-row">
          <button className="btn btn-primary" type="button" onClick={() => void handleCreateManualBackup()}>
            지금 자동 백업 생성
          </button>
          <button className="btn btn-soft" type="button" onClick={() => void refreshAutoBackups()}>
            백업 목록 새로고침
          </button>
        </div>

        <div className="button-row">
          <button className="btn btn-primary" type="button" onClick={() => void handleExport()}>
            JSON 내보내기
          </button>
          <label className="btn btn-soft file-upload">
            JSON 가져오기
            <input type="file" accept=".json,application/json" onChange={handleImport} />
          </label>
        </div>

        {backupMessage ? <p className="success-text">{backupMessage}</p> : null}
        {backupError ? <p className="error-text">{backupError}</p> : null}
        {message ? <p className="success-text">{message}</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        <div className="backup-list-block">
          <h3>자동 백업 목록</h3>
          {autoBackups.length === 0 ? <p className="empty-text">저장된 자동 백업이 없습니다.</p> : null}

          <ul className="backup-list">
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
        </div>
      </section>

      <section className="panel settings-panel">
        <header className="panel-header">
          <h2>AI 설정</h2>
        </header>

        <div className="form-grid two-col">
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
            LLM API Key
            <input
              type="password"
              value={setting.llmApiKey ?? ""}
              onChange={(event) => {
                void updateSetting({ llmApiKey: event.target.value });
              }}
              placeholder="API Key"
              autoComplete="off"
            />
          </label>
        </div>

        <p className="description-text">LLM Endpoint(코드 고정): {LLM_CHAT_COMPLETIONS_URL}</p>
        <p className="description-text">모델명/API Key는 입력 즉시 저장됩니다.</p>
      </section>

      <section className="panel">
        <header className="panel-header">
          <h2>일정 종류 관리</h2>
          <small>{sortedTypes.length}개</small>
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
            <h3>{typeForm.id ? "종류 수정" : "새 종류"}</h3>

            <label>
              종류명
              <input
                type="text"
                value={typeForm.name}
                onChange={(event) => setTypeForm((prev) => ({ ...prev, name: event.target.value }))}
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

            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={typeForm.isActive}
                onChange={(event) => setTypeForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              사용
            </label>

            <div className="button-row">
              <button className="btn btn-primary" type="submit">
                {typeForm.id ? "저장" : "생성"}
              </button>

              {typeForm.id && !typeForm.isDefault ? (
                <button className="btn btn-danger" type="button" onClick={() => void handleTypeDelete()}>
                  삭제
                </button>
              ) : null}

              <button
                className="btn btn-soft"
                type="button"
                onClick={() => {
                  setTypeError("");
                  setTypeMessage("");
                  setTypeForm(createEmptyTypeForm());
                  typeAutoSaveSnapshotRef.current = "";
                  lastTypeIdRef.current = undefined;
                }}
              >
                초기화
              </button>
            </div>

            {typeMessage ? <p className="success-text">{typeMessage}</p> : null}
            {typeError ? <p className="error-text">{typeError}</p> : null}
          </form>
        </div>
      </section>
    </div>
  );
}
