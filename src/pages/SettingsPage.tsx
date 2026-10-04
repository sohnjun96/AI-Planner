import { useEffect, useMemo, useRef, useState } from "react";
import { ColorSelector } from "../components/ColorSelector";
import { HelpModal } from "../components/HelpModal";
import { ModalBackdrop } from "../components/ModalBackdrop";
import { SettingsCategoryIcon } from "../components/SettingsCategoryIcon";
import { useSearchParams } from "../routing";
import {
  BUILD_PROFILE_LABEL,
  BUILD_PROFILE_ID,
  DEFAULT_AI_CONTEXT_MAX_LENGTH,
  DEFAULT_LLM_GEMMA_THINKING_ENABLED,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  DEFAULT_LLM_REASONING_EFFORT,
  DEFAULT_LLM_TEMPERATURE,
  DEFAULT_NOTE_AI_ACTIONS,
  DEFAULT_NOTIFY_BEFORE_MINUTES,
  LLM_DEFAULT_MODEL,
  LLM_MAX_API_KEY_LENGTH,
  LLM_MAX_MODEL_ID_LENGTH,
  MAX_AI_CONTEXT_MAX_LENGTH,
  MAX_LLM_TEMPERATURE,
  MIN_AI_CONTEXT_MAX_LENGTH,
  MIN_LLM_TEMPERATURE,
  pickRandomPresetColor,
} from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { ImportDataPreview } from "../context/AppDataContext";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useJsonBackupStatus } from "../hooks/useJsonBackupStatus";
import {
  generationOptionsFromSetting,
  isGemma4ThinkingModel,
  listLlmModels,
  requestLlmResponse,
} from "../agent/llmClient";
import type { AppSetting, NoteAiAction } from "../models";
import { formatDateTime } from "../utils/date";
import { getAiUsageStats, getTodayUsage, resetAiUsage, type AiUsageStats } from "../utils/aiUsage";
import { downloadJsonBackup } from "../utils/jsonBackup";
import { decodeBackupFile } from "../utils/backupArchive";
import { downloadNotesArchive } from "../utils/noteMarkdownExport";
import "./SettingsPage.css";

const API_KEY_AUTOSAVE_DELAY_MS = 700;

function makeActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `action-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `action-${Math.random().toString(36).slice(2, 10)}`;
}

interface NoteAiActionManagerProps {
  actions: NoteAiAction[];
  onChange: (actions: NoteAiAction[]) => void;
}

function NoteAiActionManager({ actions, onChange }: NoteAiActionManagerProps) {
  function update(id: string, patch: Partial<NoteAiAction>) {
    onChange(actions.map((action) => (action.id === id ? { ...action, ...patch } : action)));
  }
  function remove(id: string) {
    onChange(actions.filter((action) => action.id !== id));
  }
  function add() {
    onChange([...actions, { id: makeActionId(), label: "새 기능", prompt: "" }]);
  }

  return (
    <div className="ai-action-manager">
      {actions.length === 0 ? <p className="empty-text">등록된 AI 편집 기능이 없습니다.</p> : null}
      {actions.map((action) => (
        <div key={action.id} className="ai-action-row">
          <div className="ai-action-fields">
            <input
              className="ai-action-label"
              value={action.label}
              onChange={(event) => update(action.id, { label: event.target.value })}
              placeholder="버튼 이름"
              aria-label="기능 이름"
            />
            <textarea
              className="ai-action-prompt"
              value={action.prompt}
              onChange={(event) => update(action.id, { prompt: event.target.value })}
              placeholder="AI에게 보낼 프롬프트"
              rows={2}
              aria-label="프롬프트"
            />
          </div>
          <button type="button" className="btn btn-outline btn-compact" onClick={() => remove(action.id)}>
            삭제
          </button>
        </div>
      ))}
      <div className="button-row">
        <button type="button" className="btn btn-soft" onClick={add}>
          + 기능 추가
        </button>
        <button type="button" className="btn btn-soft" onClick={() => onChange(DEFAULT_NOTE_AI_ACTIONS)}>
          기본값 복원
        </button>
      </div>
    </div>
  );
}

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
type LlmModelListStatus = "idle" | "loading" | "ok" | "error";
type LlmReasoningEffortOption = NonNullable<AppSetting["llmReasoningEffort"]>;
type AiSettingsDialog = "actions" | "context";

interface PendingImport {
  fileName: string;
  raw: string;
  preview: ImportDataPreview;
}

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

type SettingsSection = "environment" | "schedule" | "notes" | "ai" | "data" | "stats";

const SETTINGS_TABS: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: "environment", label: "환경", description: "달력과 시간 표시" },
  { id: "schedule", label: "일정", description: "표시·창 호출·종류·규칙" },
  { id: "notes", label: "노트", description: "연결 추천과 AI 편집" },
  { id: "ai", label: "AI 연결", description: "서버·모델·응답 옵션" },
  { id: "data", label: "데이터·백업", description: "내보내기와 복원" },
  { id: "stats", label: "사용 현황", description: "기록·저장공간·AI 사용량" },
];

function resolveSettingsSection(value: string | null): SettingsSection {
  if (value === "types" || value === "context" || value === "notify") return "schedule";
  if (value === "noteAi") return "notes";
  if (value === "general" || value === "overview") return "environment";
  return SETTINGS_TABS.some((tab) => tab.id === value) ? (value as SettingsSection) : "environment";
}

function resolveLegacySettingsDialog(value: string | null): AiSettingsDialog | null {
  if (value === "noteAi") return "actions";
  if (value === "context") return "context";
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens < 1_000_000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export function SettingsPage() {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    setting,
    updateSetting,
    credentialStorageError,
    exportData,
    inspectImportData,
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
    tasks,
    projects,
    projectSubcategories,
    notes,
    noteVersions,
    noteTaskLinks,
  } = useAppData();

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const appVersion = __PLANAI_APP_VERSION__.trim();
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingNotes, setIsExportingNotes] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport>();
  const [isImporting, setIsImporting] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const [isBackupListOpen, setIsBackupListOpen] = useState(false);
  const [activeAiSettingsDialog, setActiveAiSettingsDialog] = useState<AiSettingsDialog | null>(
    () => resolveLegacySettingsDialog(searchParams.get("section")),
  );
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(() => searchParams.get("section") === "types");
  const [userContextDraft, setUserContextDraft] = useState("");
  const [userContextMessage, setUserContextMessage] = useState("");
  const [userContextError, setUserContextError] = useState("");
  const [aiConnectionStatus, setAiConnectionStatus] = useState<AiConnectionStatus>("idle");
  const [aiConnectionMessage, setAiConnectionMessage] = useState("연결 상태를 아직 확인하지 않았습니다.");
  const [llmModelDraft, setLlmModelDraft] = useState(() => setting.llmModel ?? LLM_DEFAULT_MODEL);
  const [llmModelInputError, setLlmModelInputError] = useState("");
  const [llmModelListStatus, setLlmModelListStatus] = useState<LlmModelListStatus>("idle");
  const [llmModelListMessage, setLlmModelListMessage] = useState("");
  const [availableLlmModels, setAvailableLlmModels] = useState<string[]>([]);
  const [isLlmModelPickerOpen, setIsLlmModelPickerOpen] = useState(false);
  const [llmModelSearch, setLlmModelSearch] = useState("");
  const [llmModelPickerError, setLlmModelPickerError] = useState("");
  const [pendingLlmModelSelection, setPendingLlmModelSelection] = useState("");
  const [isApiKeyStorageBusy, setIsApiKeyStorageBusy] = useState(false);
  const [isApiKeyStorageDirty, setIsApiKeyStorageDirty] = useState(false);
  const [noteAiActionsDraft, setNoteAiActionsDraft] = useState<NoteAiAction[]>(
    () => setting.noteAiActions ?? DEFAULT_NOTE_AI_ACTIONS,
  );
  const [aiActionMessage, setAiActionMessage] = useState("");
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => {
    return resolveSettingsSection(searchParams.get("section"));
  });
  const { isReady: isJsonBackupStatusReady, status: jsonBackupStatus } = useJsonBackupStatus();

  const [typeForm, setTypeForm] = useState<TypeFormState>(() => createEmptyTypeForm());
  const [typeMessage, setTypeMessage] = useState("");
  const [typeError, setTypeError] = useState("");
  const typeAutoSaveSnapshotRef = useRef("");
  const lastTypeIdRef = useRef<string | undefined>(undefined);
  const apiKeySaveRevisionRef = useRef(0);
  const apiKeySaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const llmModelListAbortRef = useRef<AbortController | null>(null);
  const importInProgressRef = useRef(false);

  function closePendingImport() {
    if (!isImporting) {
      setPendingImport(undefined);
      setMessage("");
    }
  }

  function closeLlmModelPicker() {
    if (!pendingLlmModelSelection) {
      setIsLlmModelPickerOpen(false);
      setLlmModelSearch("");
      setLlmModelPickerError("");
    }
  }

  const importDialogRef = useDialogFocus<HTMLElement>({
    isOpen: Boolean(pendingImport),
    onClose: closePendingImport,
  });
  const backupListDialogRef = useDialogFocus<HTMLElement>({
    isOpen: isBackupListOpen,
    onClose: () => setIsBackupListOpen(false),
  });
  const aiSettingsDialogRef = useDialogFocus<HTMLElement>({
    isOpen: activeAiSettingsDialog !== null,
    onClose: () => setActiveAiSettingsDialog(null),
  });
  const typeDialogRef = useDialogFocus<HTMLElement>({
    isOpen: isTypeModalOpen,
    onClose: () => setIsTypeModalOpen(false),
  });
  const llmModelPickerDialogRef = useDialogFocus<HTMLElement>({
    isOpen: activeSection === "ai" && isLlmModelPickerOpen,
    onClose: closeLlmModelPicker,
  });

  const sortedTypes = useMemo(() => [...taskTypes].sort((a, b) => a.order - b.order), [taskTypes]);
  const aiContextMaxLength = setting.aiContextMaxLength ?? DEFAULT_AI_CONTEXT_MAX_LENGTH;
  const savedUserContextLength = Math.min(userContext.markdown.length, aiContextMaxLength);
  const isGemma4ThinkingAvailable = isGemma4ThinkingModel(llmModelDraft);
  const filteredLlmModels = useMemo(() => {
    const query = llmModelSearch.trim().toLocaleLowerCase("en-US");
    if (!query) return availableLlmModels;
    return availableLlmModels.filter((model) => model.toLocaleLowerCase("en-US").includes(query));
  }, [availableLlmModels, llmModelSearch]);
  const savedNoteAiActions = setting.noteAiActions ?? DEFAULT_NOTE_AI_ACTIONS;
  const savedActionPreview = savedNoteAiActions
    .slice(0, 3)
    .map((action) => action.label)
    .join(" · ");
  const activeAiDialogTitle =
    activeAiSettingsDialog === "actions"
      ? "노트 AI 편집 기능"
      : "AI 일정 맞춤 규칙";
  const activeAiDialogDescription =
    activeAiSettingsDialog === "actions"
      ? "노트 편집 화면과 우클릭 메뉴에 표시할 AI 기능과 프롬프트를 관리합니다."
      : "AI 일정 추가에 적용할 개인 규칙을 관리합니다. 본문은 저장 버튼으로 적용합니다.";

  useEffect(() => {
    importInProgressRef.current = isImporting;
  }, [isImporting]);

  useEffect(() => {
    const section = searchParams.get("section");
    const canOpenLinkedDialog = !importInProgressRef.current;
    setActiveSection(resolveSettingsSection(section));
    setActiveAiSettingsDialog(canOpenLinkedDialog ? resolveLegacySettingsDialog(section) : null);
    setIsTypeModalOpen(canOpenLinkedDialog && section === "types");
    setIsBackupListOpen(false);
    setIsLlmModelPickerOpen(false);
    setIsHelpOpen(false);
    if (canOpenLinkedDialog) setPendingImport(undefined);
  }, [searchParams]);

  useEffect(() => {
    setAiConnectionStatus("idle");
    setAiConnectionMessage("연결 상태를 아직 확인하지 않았습니다. '연결 확인'을 눌러 실제 요청을 테스트하세요.");
  }, [
    setting.llmApiKey,
    setting.llmEndpoint,
    setting.llmGemmaThinkingEnabled,
    setting.llmModel,
    setting.llmReasoningEffort,
    setting.llmTemperature,
  ]);

  useEffect(() => {
    setLlmModelDraft(setting.llmModel ?? LLM_DEFAULT_MODEL);
  }, [setting.llmModel]);

  useEffect(() => {
    llmModelListAbortRef.current?.abort();
    llmModelListAbortRef.current = null;
    setAvailableLlmModels([]);
    setLlmModelListStatus("idle");
    setLlmModelListMessage("");
    setIsLlmModelPickerOpen(false);
    setLlmModelSearch("");
    setLlmModelPickerError("");
  }, [setting.llmApiKey, setting.llmEndpoint]);

  useEffect(() => {
    return () => llmModelListAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isApiKeyStorageDirty) return;

    const revision = apiKeySaveRevisionRef.current;
    const apiKey = setting.llmApiKey ?? "";
    const timerId = window.setTimeout(() => {
      apiKeySaveQueueRef.current = apiKeySaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (revision !== apiKeySaveRevisionRef.current) return;

          setIsApiKeyStorageBusy(true);
          try {
            await updateSetting({
              llmApiKey: apiKey,
              rememberLlmApiKey: Boolean(apiKey.trim()),
            });
            if (revision === apiKeySaveRevisionRef.current) {
              setError("");
              setMessage(
                apiKey.trim()
                  ? "API 키를 브라우저 저장소에 자동 저장하고 검증했습니다."
                  : "브라우저 저장소에서 API 키를 삭제했습니다.",
              );
              setIsApiKeyStorageDirty(false);
            }
          } catch (storageError) {
            if (revision === apiKeySaveRevisionRef.current) {
              setError(storageError instanceof Error ? storageError.message : "API 키를 자동 저장하지 못했습니다.");
            }
          } finally {
            if (revision === apiKeySaveRevisionRef.current) {
              setIsApiKeyStorageBusy(false);
            }
          }
        });
    }, API_KEY_AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, [isApiKeyStorageDirty, setting.llmApiKey, updateSetting]);

  function selectSection(section: SettingsSection) {
    setActiveAiSettingsDialog(null);
    setIsTypeModalOpen(false);
    setIsBackupListOpen(false);
    setIsLlmModelPickerOpen(false);
    setActiveSection(section);
    setSearchParams({ section });
  }

  // ===== 통계 탭 데이터 =====
  const taskStats = useMemo(() => {
    let notDone = 0;
    let onHold = 0;
    let done = 0;
    let canceled = 0;
    let major = 0;
    let thisWeek = 0;
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    const weekStartOffset = setting.weekStartsOn === "mon"
      ? (weekStart.getDay() + 6) % 7
      : weekStart.getDay();
    weekStart.setDate(weekStart.getDate() - weekStartOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    for (const task of tasks) {
      if (task.status === "NOT_DONE") notDone += 1;
      else if (task.status === "ON_HOLD") onHold += 1;
      else if (task.status === "DONE") done += 1;
      else canceled += 1;
      if (task.isMajor) major += 1;
      const start = new Date(task.startAt);
      if (start >= weekStart && start < weekEnd) thisWeek += 1;
    }
    return { total: tasks.length, notDone, onHold, done, canceled, major, thisWeek };
  }, [setting.weekStartsOn, tasks]);

  const noteStats = useMemo(() => {
    let archived = 0;
    let pinned = 0;
    let openChecks = 0;
    let contentChars = 0;
    for (const note of notes) {
      if (note.status === "archived") archived += 1;
      if (note.isPinned) pinned += 1;
      openChecks += note.content.match(/^\s*[-*+]\s+\[ \]/gm)?.length ?? 0;
      contentChars += note.content.length;
    }
    return {
      total: notes.length,
      active: notes.length - archived,
      archived,
      pinned,
      openChecks,
      versions: noteVersions.length,
      links: noteTaskLinks.length,
      contentChars,
    };
  }, [notes, noteVersions, noteTaskLinks]);

  const [storageEstimate, setStorageEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageStats>(() => getAiUsageStats());

  useEffect(() => {
    if (activeSection !== "stats") {
      return;
    }
    setAiUsage(getAiUsageStats());
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((estimate) => setStorageEstimate({ usage: estimate.usage, quota: estimate.quota }))
        .catch(() => setStorageEstimate(null));
    }
  }, [activeSection]);

  const todayUsage = getTodayUsage(aiUsage);
  const backupBytes = useMemo(() => autoBackups.reduce((sum, backup) => sum + (backup.size ?? 0), 0), [autoBackups]);

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
    setNoteAiActionsDraft(setting.noteAiActions ?? DEFAULT_NOTE_AI_ACTIONS);
  }, [setting.noteAiActions]);

  async function handleSaveAiActions() {
    setAiActionMessage("");
    const cleaned = noteAiActionsDraft
      .map((action) => ({ ...action, label: action.label.trim() || "기능", prompt: action.prompt.trim() }))
      .filter((action) => action.prompt);
    try {
      await updateSetting({ noteAiActions: cleaned.length > 0 ? cleaned : DEFAULT_NOTE_AI_ACTIONS });
      setAiActionMessage("AI 편집 기능을 저장했습니다.");
    } catch (saveError) {
      setAiActionMessage(saveError instanceof Error ? saveError.message : "저장에 실패했습니다.");
    }
  }

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
    if (isExporting) {
      return;
    }
    setError("");
    setMessage("");
    setIsExporting(true);
    try {
      const content = await exportData();
      await downloadJsonBackup(content);
      setMessage("백업 파일을 내보냈습니다.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "백업 파일 내보내기에 실패했습니다.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const content = await decodeBackupFile(file);
      const preview = inspectImportData(content);
      setPendingImport({ fileName: file.name, raw: content, preview });
      setMessage("백업 파일을 확인했습니다. 가져올 항목과 교체 범위를 검토해 주세요.");
    } catch (importError) {
      setPendingImport(undefined);
      setError(importError instanceof Error ? importError.message : "백업 파일을 확인하지 못했습니다.");
    } finally {
      input.value = "";
    }
  }

  async function handleNotesExport() {
    if (isExportingNotes) return;
    setError("");
    setMessage("");
    setIsExportingNotes(true);
    try {
      const result = await downloadNotesArchive(notes, projects, projectSubcategories);
      setMessage(`노트 ${result.fileCount}개를 ZIP 파일로 내보냈습니다.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "노트를 내보내지 못했습니다.");
    } finally {
      setIsExportingNotes(false);
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport || isImporting) {
      return;
    }

    setError("");
    setMessage("");
    setIsImporting(true);
    let backupCreated = false;
    try {
      await createAutoBackup("백업 불러오기 직전");
      backupCreated = true;
      await importData(pendingImport.raw);
      setPendingImport(undefined);
      setMessage("백업 파일을 가져왔습니다. 교체 전 데이터는 자동 백업 목록에 보관했습니다.");
    } catch (importError) {
      const detail = importError instanceof Error ? importError.message : "알 수 없는 오류";
      setError(
        backupCreated
          ? `가져오기를 완료하지 못했습니다. 교체 전 데이터는 자동 백업 목록에 보관했습니다. ${detail}`
          : `안전 백업을 만들지 못해 가져오기를 시작하지 않았습니다. 기존 데이터는 그대로입니다. ${detail}`,
      );
    } finally {
      setIsImporting(false);
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
      setUserContextMessage("AI 맞춤 규칙을 저장했습니다.");
    } catch (contextSaveError) {
      setUserContextError(contextSaveError instanceof Error ? contextSaveError.message : "AI 맞춤 규칙 저장에 실패했습니다.");
    }
  }

  async function handleResetUserContext() {
    const shouldReset = window.confirm("AI 맞춤 규칙을 기본값으로 되돌릴까요?");
    if (!shouldReset) {
      return;
    }

    setUserContextError("");
    setUserContextMessage("");

    try {
      await resetUserContext();
      setUserContextMessage("AI 맞춤 규칙 기본값을 복원했습니다.");
    } catch (contextResetError) {
      setUserContextError(contextResetError instanceof Error ? contextResetError.message : "AI 맞춤 규칙 초기화에 실패했습니다.");
    }
  }

  async function saveLlmModelDraft(): Promise<string | undefined> {
    const model = llmModelDraft.trim() || LLM_DEFAULT_MODEL;
    setLlmModelInputError("");
    try {
      await updateSetting({ llmModel: model });
      setLlmModelDraft(model);
      return model;
    } catch (modelSaveError) {
      setLlmModelInputError(
        modelSaveError instanceof Error ? modelSaveError.message : "LLM 모델명을 저장하지 못했습니다.",
      );
      return undefined;
    }
  }

  async function handleLoadLlmModels() {
    if (llmModelListAbortRef.current) return;
    const controller = new AbortController();
    llmModelListAbortRef.current = controller;
    setIsLlmModelPickerOpen(true);
    setLlmModelSearch("");
    setLlmModelPickerError("");
    setLlmModelListStatus("loading");
    setLlmModelListMessage("사용 가능한 모델 목록을 불러오는 중입니다.");

    try {
      const models = await listLlmModels({
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        apiKey: setting.llmApiKey ?? "",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      setAvailableLlmModels(models);
      setLlmModelListStatus("ok");
      const currentModel = llmModelDraft.trim();
      setLlmModelListMessage(
        models.length > 0
          ? currentModel && !models.includes(currentModel)
            ? `${models.length}개 모델을 불러왔습니다. 현재 모델은 서버 목록에 없으므로 사용할 모델을 선택해 주세요.`
            : `${models.length}개 모델을 불러왔습니다. 목록에서 선택하거나 직접 입력할 수 있습니다.`
          : "조회된 모델이 없습니다. 모델명을 직접 입력해 주세요.",
      );
    } catch (modelListError) {
      if (controller.signal.aborted) return;
      setAvailableLlmModels([]);
      setLlmModelListStatus("error");
      setLlmModelListMessage(
        `${modelListError instanceof Error ? modelListError.message : "모델 목록을 불러오지 못했습니다."} 모델명은 직접 입력할 수 있습니다.`,
      );
    } finally {
      if (llmModelListAbortRef.current === controller) {
        llmModelListAbortRef.current = null;
      }
    }
  }

  async function handleSelectLlmModel(model: string) {
    if (pendingLlmModelSelection || !availableLlmModels.includes(model)) return;

    setPendingLlmModelSelection(model);
    setLlmModelPickerError("");
    setLlmModelInputError("");
    try {
      await updateSetting({ llmModel: model });
      setLlmModelDraft(model);
      setLlmModelListStatus("ok");
      setLlmModelListMessage(`${model} 모델을 선택했습니다.`);
      setIsLlmModelPickerOpen(false);
      setLlmModelSearch("");
    } catch (modelSelectionError) {
      const selectionError = modelSelectionError instanceof Error
        ? modelSelectionError.message
        : "LLM 모델명을 저장하지 못했습니다.";
      setLlmModelPickerError(selectionError);
      setLlmModelInputError(selectionError);
    } finally {
      setPendingLlmModelSelection("");
    }
  }

  async function handleCheckAiConnection() {
    const model = await saveLlmModelDraft();
    if (!model) {
      setAiConnectionStatus("error");
      setAiConnectionMessage("올바른 LLM 모델명을 입력해 주세요.");
      return;
    }

    const startedAt = performance.now();
    setAiConnectionStatus("checking");
    setAiConnectionMessage("AI 연결을 확인하는 중입니다.");
    try {
      const response = await requestLlmResponse({
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        model,
        apiKey: setting.llmApiKey ?? "",
        generationOptions: generationOptionsFromSetting(setting),
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
      setAiConnectionStatus("ok");
      setAiConnectionMessage(`연결 성공 (${model}, ${elapsedMs}ms): ${response.slice(0, 80)}`);
    } catch (connectionError) {
      setAiConnectionStatus("error");
      setAiConnectionMessage(connectionError instanceof Error ? connectionError.message : "AI 연결 확인에 실패했습니다.");
    }
  }

  async function handleDeleteApiKey() {
    apiKeySaveRevisionRef.current += 1;
    setError("");
    setMessage("");
    setIsApiKeyStorageBusy(true);
    setIsApiKeyStorageDirty(false);
    try {
      await apiKeySaveQueueRef.current.catch(() => undefined);
      await updateSetting({ llmApiKey: "", rememberLlmApiKey: false });
      setMessage("메모리와 브라우저 저장소에서 API 키를 삭제했습니다.");
    } catch (storageError) {
      setError(storageError instanceof Error ? storageError.message : "API 키를 삭제하지 못했습니다.");
    } finally {
      setIsApiKeyStorageBusy(false);
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

  const activeCategory = SETTINGS_TABS.find((tab) => tab.id === activeSection) ?? SETTINGS_TABS[0];
  const aiStatusLabel = aiConnectionStatus === "checking" ? "확인 중" : aiConnectionStatus === "ok" ? "정상" : aiConnectionStatus === "error" ? "실패" : "미확인";
  const lastExportLabel = !isJsonBackupStatusReady ? "확인 중…" : jsonBackupStatus.lastExportedAt ? formatDateTime(jsonBackupStatus.lastExportedAt, setting.timeFormat) : "아직 없음";

  return (
    <div className="settings-workspace settings-redesigned">
      <section className="settings-header-section settings-section-panel" aria-labelledby="settings-page-title">
        <header className="settings-page-header">
          <div className="settings-page-title">
            <div className="settings-title-row">
              <h2 id="settings-page-title">설정</h2>
              {appVersion ? <span className="settings-version-badge">v{appVersion}</span> : null}
            </div>
            <p className="description-text">나의 작업 환경을 관리합니다.</p>
          </div>
        </header>
      </section>

      {isHelpOpen ? <HelpModal onClose={() => setIsHelpOpen(false)} /> : null}

      <div className="settings-edit-layout">
        <aside className="settings-sidebar settings-section-panel">
          <p className="settings-sidebar-heading">설정 메뉴</p>
          <nav className="settings-category-list" aria-label="설정 분류">
            {SETTINGS_TABS.map((tab) => (
              <button key={tab.id} type="button" className={`settings-tab settings-category-button ${activeSection === tab.id ? "active" : ""}`} aria-label={tab.label} aria-pressed={activeSection === tab.id} aria-controls="settings-category-content" onClick={() => selectSection(tab.id)}>
                <span className="settings-category-icon"><SettingsCategoryIcon category={tab.id} /></span>
                <span className="settings-category-copy">
                  <span className="settings-category-label">{tab.label}</span>
                  <span className="settings-category-description">{tab.description}</span>
                </span>
              </button>
            ))}
          </nav>
          <div className="settings-sidebar-footer">
            <dl className="settings-navigation-status" aria-label="연결과 백업 요약">
              <div><dt>AI 연결</dt><dd>{aiStatusLabel}</dd></div>
              <div><dt>자동 백업</dt><dd>{setting.autoBackupEnabled ? `${setting.autoBackupIntervalMinutes ?? 360}분 · ${autoBackups.length}개` : "사용 안 함"}</dd></div>
              <div><dt>파일 내보내기</dt><dd>{lastExportLabel}</dd></div>
            </dl>
            <button className="btn btn-soft" type="button" onClick={() => setIsHelpOpen(true)}>도움말 · 단축키</button>
          </div>
        </aside>

        <section id="settings-category-content" className="settings-content" aria-labelledby="settings-category-title">
          <header className="settings-content-header settings-section-panel">
            <div className="settings-content-heading">
              <span className="settings-content-icon"><SettingsCategoryIcon category={activeCategory.id} /></span>
              <div><h2 id="settings-category-title">{activeCategory.label}</h2><p className="description-text">{activeCategory.description}</p></div>
            </div>
            {activeSection === "ai" ? <span className="settings-save-note" data-state={aiConnectionStatus}>연결 {aiStatusLabel}</span> : activeSection !== "stats" ? <span className="settings-save-note">기본 설정은 변경 시 자동 저장</span> : null}
          </header>
          <div className="settings-page-feedback">
            {message ? <p className="success-text" role="status" aria-live="polite">{message}</p> : null}
            {error ? <p className="error-text" role="alert">{error}</p> : null}
          </div>
          <div className="settings-section-host">
            {activeSection === "environment" ? (
              <section className="settings-card">
                <header className="settings-card-header"><h3>달력과 시간</h3></header>
                <div className="settings-preference-list">
                  <label className="settings-preference-row"><span>주 시작 요일</span><select value={setting.weekStartsOn} onChange={(event) => void updateSetting({ weekStartsOn: event.target.value as "sun" | "mon" })}><option value="sun">일요일</option><option value="mon">월요일</option></select></label>
                  <label className="settings-preference-row"><span>시간 표시 형식</span><select value={setting.timeFormat} onChange={(event) => void updateSetting({ timeFormat: event.target.value as "24h" | "12h" })}><option value="24h">24시간제</option><option value="12h">12시간제</option></select></label>
                </div>
              </section>
            ) : null}

            {activeSection === "schedule" ? (
              <>
                <section className="settings-card">
                  <header className="settings-card-header"><h3>일정 표시와 창 호출</h3></header>
                  <label className="checkbox-inline settings-toggle-row"><input type="checkbox" checked={setting.showPastCompleted} onChange={(event) => void updateSetting({ showPastCompleted: event.target.checked })} />지난 완료 업무를 기본으로 표시</label>
                  <label className="checkbox-inline settings-toggle-row"><input type="checkbox" checked={Boolean(setting.notificationsEnabled)} onChange={(event) => void updateSetting({ notificationsEnabled: event.target.checked })} />일정 시작 전 플래나이 창 표시</label>
                  <label className="settings-preference-row"><span>플래나이 표시 시간(분 전)</span><input type="text" inputMode="numeric" value={String(setting.notifyBeforeMinutes ?? DEFAULT_NOTIFY_BEFORE_MINUTES)} onChange={(event) => { const next = Number(event.target.value.replace(/[^0-9]/g, "")); void updateSetting({ notifyBeforeMinutes: Number.isFinite(next) ? next : 0 }); }} /></label>
                </section>
                <section className="settings-card">
                  <header className="settings-card-header"><h3>일정 분류와 AI 규칙</h3></header>
                  <div className="settings-managed-list">
                    <div className="settings-managed-row">
                      <div className="settings-managed-copy"><strong>일정 종류 관리</strong><p>{sortedTypes.length}개 종류 · 이름, 색상과 사용 여부</p><div className="settings-type-summary">{sortedTypes.slice(0, 5).map((type) => <span className="settings-type-summary-chip" key={type.id}><span className="color-dot" style={{ backgroundColor: type.color }} />{type.name}</span>)}{sortedTypes.length > 5 ? <span className="settings-type-summary-chip">외 {sortedTypes.length - 5}개</span> : null}</div></div>
                      <button type="button" className="btn btn-soft" onClick={() => setIsTypeModalOpen(true)}>종류 관리</button>
                    </div>
                    <div className="settings-managed-row">
                      <div className="settings-managed-copy"><strong>AI 일정 맞춤 규칙</strong><p>{savedUserContextLength} / {aiContextMaxLength}자 · AI 일정 추가에 적용</p></div>
                      <button type="button" className="btn btn-soft" onClick={() => { setUserContextMessage(""); setUserContextError(""); setActiveAiSettingsDialog("context"); }}>맞춤 규칙 편집</button>
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            {activeSection === "notes" ? (
              <>
                <section className="settings-card">
                  <header className="settings-card-header"><h3>연결 추천</h3><small>AI 연결 없이 사용</small></header>
                  <div className="settings-managed-list">
                    <div className="settings-managed-row"><div className="settings-managed-copy"><strong>관련 일정 자동 추천</strong><p>노트의 내용, 프로젝트, 작성일을 기준으로 추천합니다.</p></div><label className="checkbox-inline settings-toggle-row settings-ai-feature-toggle"><input type="checkbox" aria-label="관련 일정 자동 추천" checked={setting.noteTaskSuggestionsEnabled ?? false} onChange={(event) => void updateSetting({ noteTaskSuggestionsEnabled: event.currentTarget.checked })} />사용</label></div>
                    <div className="settings-managed-row"><div className="settings-managed-copy"><strong>관련 노트 자동 추천</strong><p>제목, 내용, 프로젝트, 태그가 비슷한 노트를 추천합니다.</p></div><label className="checkbox-inline settings-toggle-row settings-ai-feature-toggle"><input type="checkbox" aria-label="관련 노트 자동 추천" checked={setting.relatedNoteSuggestionsEnabled ?? false} onChange={(event) => void updateSetting({ relatedNoteSuggestionsEnabled: event.currentTarget.checked })} />사용</label></div>
                  </div>
                </section>
                <section className="settings-card">
                  <header className="settings-card-header"><h3>AI 편집</h3></header>
                  <div className="settings-managed-row"><div className="settings-managed-copy"><strong>노트 AI 편집 기능</strong><p>{savedNoteAiActions.length}개 기능{savedActionPreview ? ` · ${savedActionPreview}${savedNoteAiActions.length > 3 ? " 외" : ""}` : ""}</p></div><button type="button" className="btn btn-soft" onClick={() => { setAiActionMessage(""); setActiveAiSettingsDialog("actions"); }}>AI 편집 기능 관리</button></div>
                </section>
              </>
            ) : null}

        {activeSection === "ai" ? (
        <section className="settings-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">
                {BUILD_PROFILE_ID === "external" ? `AI · ${BUILD_PROFILE_LABEL}` : "AI"}
              </p>
              <h3>서버 연결</h3>
            </div>
            <div className="settings-card-header-actions">
              <button
                type="button"
                className="btn btn-soft"
                disabled={llmModelListStatus === "loading"}
                onClick={() => void handleLoadLlmModels()}
              >
                {llmModelListStatus === "loading" ? "모델 불러오는 중" : "모델 목록 불러오기"}
              </button>
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
            </div>
          </header>

          <div className="form-grid settings-ai-connection-grid">
            <label>
              Endpoint 주소
              <input
                type="url"
                value={setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL}
                readOnly
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label>
              LLM API 키
              <input
                type="password"
                value={setting.llmApiKey ?? ""}
                onChange={(event) => {
                  apiKeySaveRevisionRef.current += 1;
                  setError("");
                  setMessage("");
                  setIsApiKeyStorageDirty(true);
                  void updateSetting({ llmApiKey: event.target.value });
                }}
                placeholder="API 키"
                autoComplete="off"
                maxLength={LLM_MAX_API_KEY_LENGTH}
              />
            </label>
            <label>
              LLM 모델명
              <input
                type="text"
                value={llmModelDraft}
                onChange={(event) => {
                  setLlmModelDraft(event.currentTarget.value);
                  setLlmModelInputError("");
                }}
                onBlur={() => void saveLlmModelDraft()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                placeholder={LLM_DEFAULT_MODEL}
                maxLength={LLM_MAX_MODEL_ID_LENGTH}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(llmModelInputError)}
                aria-describedby="llm-model-help"
              />
              <small id="llm-model-help" className="settings-field-help">
                서버 목록에서 선택하거나 모델 식별자를 직접 입력할 수 있습니다.
              </small>
              {llmModelInputError ? <small className="error-text" role="alert">{llmModelInputError}</small> : null}
            </label>

          </div>

          <div className="button-row compact">
            <button
              type="button"
              className="btn btn-outline"
              disabled={isApiKeyStorageBusy || (!setting.rememberLlmApiKey && !(setting.llmApiKey ?? "").trim())}
              onClick={() => void handleDeleteApiKey()}
            >
              메모리·저장소에서 키 삭제
            </button>
          </div>

          {llmModelListStatus !== "idle" ? (
            <p
              className={`endpoint-status ${llmModelListStatus === "loading" ? "checking" : llmModelListStatus}`}
              role={llmModelListStatus === "error" ? "alert" : "status"}
              aria-live={llmModelListStatus === "error" ? "assertive" : "polite"}
            >
              {llmModelListMessage}
            </p>
          ) : null}

          {isApiKeyStorageBusy || isApiKeyStorageDirty ? (
            <p className="description-text" role="status">
              {isApiKeyStorageBusy ? "API 키를 브라우저 저장소에 저장하고 검증하는 중입니다." : "입력이 끝나면 API 키를 자동 저장합니다."}
            </p>
          ) : null}
          {credentialStorageError ? (
            <p className="error-text" role="alert">{credentialStorageError}</p>
          ) : null}
          <p
            className={`endpoint-status ${aiConnectionStatus === "idle" ? "" : aiConnectionStatus}`}
            role={aiConnectionStatus === "error" ? "alert" : "status"}
            aria-live={aiConnectionStatus === "error" ? "assertive" : "polite"}
          >
            {aiConnectionStatus === "idle" ? "미확인 · " : aiConnectionStatus === "ok" ? "정상 · " : aiConnectionStatus === "error" ? "실패 · " : ""}
            {aiConnectionMessage}
          </p>
        </section>
        ) : null}



            {activeSection === "ai" ? (
              <>
                <section className="settings-card settings-generation-options-card" aria-labelledby="settings-generation-options-title">
                  <header className="settings-card-header"><h3 id="settings-generation-options-title">공통 응답 옵션</h3></header>
                  <p className="description-text">
                    일정 생성, 노트 편집 등 모든 AI 기능에 공통으로 적용됩니다. 값은 변경 즉시 저장됩니다.
                  </p>

                  <div className="form-grid two-col settings-generation-options-grid">
                    <label>
                      Temperature
                      <input
                        type="number"
                        min={MIN_LLM_TEMPERATURE}
                        max={MAX_LLM_TEMPERATURE}
                        step={0.1}
                        value={setting.llmTemperature ?? DEFAULT_LLM_TEMPERATURE}
                        aria-describedby="llm-temperature-help"
                        onChange={(event) => {
                          const next = event.currentTarget.valueAsNumber;
                          if (Number.isFinite(next)) {
                            void updateSetting({
                              llmTemperature: Math.max(MIN_LLM_TEMPERATURE, Math.min(MAX_LLM_TEMPERATURE, next)),
                            });
                          }
                        }}
                      />
                      <small id="llm-temperature-help" className="settings-field-help">
                        0에 가까울수록 일관되고, 높을수록 다양한 답변을 만듭니다. 범위 {MIN_LLM_TEMPERATURE}–{MAX_LLM_TEMPERATURE}
                      </small>
                    </label>

                    <label>
                      추론 강도 (Reasoning effort)
                      <select
                        value={setting.llmReasoningEffort ?? DEFAULT_LLM_REASONING_EFFORT}
                        aria-describedby="llm-reasoning-help"
                        onChange={(event) => {
                          void updateSetting({ llmReasoningEffort: event.currentTarget.value as LlmReasoningEffortOption });
                        }}
                      >
                        <option value="default">서버 기본값 (전송하지 않음)</option>
                        <option value="none">사용 안 함 (none)</option>
                        <option value="low">낮음 (low)</option>
                        <option value="medium">중간 (medium)</option>
                        <option value="high">높음 (high)</option>
                      </select>
                      <small id="llm-reasoning-help" className="settings-field-help">
                        지원 모델과 서버에서만 적용되며, 단계별 동작은 서버 구현에 따라 다를 수 있습니다.
                      </small>
                    </label>
                  </div>

                  {isGemma4ThinkingAvailable ? (
                    <label className="checkbox-inline settings-toggle-row settings-thinking-toggle">
                      <input
                        type="checkbox"
                        checked={setting.llmGemmaThinkingEnabled ?? DEFAULT_LLM_GEMMA_THINKING_ENABLED}
                        aria-describedby="gemma-thinking-help"
                        onChange={(event) => {
                          void updateSetting({ llmGemmaThinkingEnabled: event.currentTarget.checked });
                        }}
                      />
                      <span className="settings-toggle-copy">
                        <span className="settings-toggle-title">
                          Thinking 모드
                          <small className="settings-option-badge">Gemma4 26B A4B/MoE 전용</small>
                        </span>
                        <small id="gemma-thinking-help" className="settings-field-help">
                          켜면 enable_thinking: true와 skip_special_tokens: false를 함께 보냅니다. Gemma4에서는 이 토글이 위 추론 강도보다 우선합니다.
                        </small>
                      </span>
                    </label>
                  ) : (
                    <div className="settings-inline-note">
                      <span>현재 모델에는 공통 옵션만 적용됩니다. Gemma4 26B A4B/MoE 모델이 감지되면 Thinking 모드가 나타납니다.</span>
                    </div>
                  )}

                  <p className="description-text">
                    일부 서버나 모델은 이 옵션을 지원하지 않을 수 있습니다. 변경 후 연결 확인으로 호환성을 확인하세요.
                  </p>
                </section>
                <div className="settings-section-links"><button type="button" className="btn btn-outline" onClick={() => { setSearchParams({ section: "context" }); }}>일정 AI 맞춤 규칙</button><button type="button" className="btn btn-outline" onClick={() => { setSearchParams({ section: "noteAi" }); }}>노트 AI 편집 설정</button></div>
              </>
            ) : null}

            {activeSection === "data" ? (
              <>
                <section className="settings-card">
                  <header className="settings-card-header"><h3>파일로 보관</h3></header>
                  <div className="settings-managed-list">
                    <div className="settings-data-file-row"><div className="settings-managed-copy"><strong>전체 백업 내보내기</strong><p>마지막 내보내기: {lastExportLabel}</p></div><button className="btn btn-primary" type="button" onClick={() => void handleExport()} disabled={isExporting}>{isExporting ? "내보내는 중…" : "백업 내보내기"}</button></div>
                    <div className="settings-data-file-row"><div className="settings-managed-copy"><strong>백업 불러오기</strong><p>가져올 내용을 확인하고 교체 직전 백업을 보관합니다.</p></div><label className="btn btn-soft file-upload">백업 불러오기<input type="file" accept=".json,.zip,application/json,application/zip" onChange={handleImport} /></label></div>
                    <div className="settings-data-file-row"><div className="settings-managed-copy"><strong>노트 내보내기</strong><p>노트를 Markdown ZIP 파일로 보관합니다.</p></div><button className="btn btn-soft" type="button" onClick={() => void handleNotesExport()} disabled={isExportingNotes || notes.length === 0}>{isExportingNotes ? "노트 내보내는 중…" : "노트 내보내기"}</button></div>
                  </div>
                  <p className="settings-field-help">전체 백업 파일은 5MB 초과 시 ZIP으로 압축하며, 압축 전 50MB까지 지원합니다.</p>
                </section>
                <section className="settings-card settings-backup-card">
                  <header className="settings-card-header"><h3>브라우저 안에 보관</h3></header>
                  <label className="checkbox-inline settings-toggle-row"><input type="checkbox" checked={Boolean(setting.autoBackupEnabled)} onChange={(event) => void updateSetting({ autoBackupEnabled: event.target.checked })} />자동 백업 사용</label>
                  <label className="settings-preference-row"><span>자동 백업 주기(분)</span><input type="text" inputMode="numeric" value={String(setting.autoBackupIntervalMinutes ?? 360)} onChange={(event) => { const next = Number(event.target.value.replace(/[^0-9]/g, "")); void updateSetting({ autoBackupIntervalMinutes: Number.isFinite(next) ? next : 15 }); }} /></label>
                  <p className="settings-field-help">이 브라우저의 별도 저장소에 최대 20개·합계 100MB까지 보관하며 오래된 항목부터 정리합니다. 컴퓨터에 파일을 남기려면 위의 백업 내보내기를 사용하세요.</p>
                  <div className="settings-backup-actions"><button className="btn btn-primary" type="button" onClick={() => void handleCreateManualBackup()}>앱 내부 백업 생성</button></div>
                  {backupMessage ? <p className="success-text" role="status" aria-live="polite">{backupMessage}</p> : null}
                  {backupError ? <p className="error-text" role="alert">{backupError}</p> : null}
                  <div className="settings-managed-row"><div className="settings-managed-copy"><strong>자동 백업 목록</strong><p>{autoBackups.length > 0 ? `저장된 백업 ${autoBackups.length}개 · 목록에서 복원·삭제` : "저장된 자동 백업이 없습니다."}</p></div><button className="btn btn-soft" type="button" onClick={openBackupList}>자동 백업 목록 보기</button></div>
                </section>
              </>
            ) : null}

        {activeSection === "stats" ? (
        <section className="settings-card">
          <header className="settings-card-header">
            <div>

              <h3>기록 현황</h3>
            </div>
          </header>

          <div className="stats-groups">
            <div className="stats-group">
              <h4 className="stats-group-title">📅 일정</h4>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">전체</span>
                  <strong className="stat-value">{taskStats.total}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">미완료</span>
                  <strong className="stat-value">{taskStats.notDone}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">완료</span>
                  <strong className="stat-value">{taskStats.done}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">보류 · 취소</span>
                  <strong className="stat-value">
                    {taskStats.onHold} · {taskStats.canceled}
                  </strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">이번 주</span>
                  <strong className="stat-value">{taskStats.thisWeek}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">중요 일정</span>
                  <strong className="stat-value">{taskStats.major}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">프로젝트</span>
                  <strong className="stat-value">{projects.length}</strong>
                </div>
              </div>
            </div>

            <div className="stats-group">
              <h4 className="stats-group-title">📝 노트</h4>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">활성</span>
                  <strong className="stat-value">{noteStats.active}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">보관됨</span>
                  <strong className="stat-value">{noteStats.archived}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">고정</span>
                  <strong className="stat-value">{noteStats.pinned}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">미완료 체크</span>
                  <strong className="stat-value">{noteStats.openChecks}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">일정 연결</span>
                  <strong className="stat-value">{noteStats.links}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">저장된 버전</span>
                  <strong className="stat-value">{noteStats.versions}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">본문 분량</span>
                  <strong className="stat-value">{formatBytes(noteStats.contentChars * 2)}</strong>
                </div>
              </div>
            </div>

            <div className="stats-group">
              <h4 className="stats-group-title">💾 저장공간</h4>
              {storageEstimate?.quota ? (
                <>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <span className="stat-label">사용 중</span>
                      <strong className="stat-value">{formatBytes(storageEstimate.usage ?? 0)}</strong>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">할당량</span>
                      <strong className="stat-value">{formatBytes(storageEstimate.quota)}</strong>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">자동 백업</span>
                      <strong className="stat-value">
                        {autoBackups.length}개 · {formatBytes(backupBytes)}
                      </strong>
                    </div>
                  </div>
                  <div
                    className="stats-storage-bar"
                    role="progressbar"
                    aria-valuenow={Math.round(((storageEstimate.usage ?? 0) / storageEstimate.quota) * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="stats-storage-fill"
                      style={{ width: `${Math.max(0.5, ((storageEstimate.usage ?? 0) / storageEstimate.quota) * 100)}%` }}
                    />
                  </div>
                  <p className="description-text">
                    브라우저가 이 앱(IndexedDB 포함)에 배정한 공간 기준입니다. 사용률{" "}
                    {(((storageEstimate.usage ?? 0) / storageEstimate.quota) * 100).toFixed(2)}%
                  </p>
                </>
              ) : (
                <p className="description-text">이 브라우저에서는 저장공간 정보를 제공하지 않습니다.</p>
              )}
            </div>

            <div className="stats-group">
              <div className="stats-group-head">
                <h4 className="stats-group-title">✨ AI 사용 (토큰)</h4>
                <button
                  type="button"
                  className="btn btn-outline btn-compact"
                  onClick={() => {
                    resetAiUsage();
                    setAiUsage(getAiUsageStats());
                  }}
                  disabled={aiUsage.totalRequests === 0}
                >
                  초기화
                </button>
              </div>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">오늘 요청</span>
                  <strong className="stat-value">{todayUsage.requests}회</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">오늘 토큰</span>
                  <strong className="stat-value">{formatTokens(todayUsage.promptTokens + todayUsage.completionTokens)}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">누적 요청</span>
                  <strong className="stat-value">{aiUsage.totalRequests}회</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">누적 입력 토큰</span>
                  <strong className="stat-value">{formatTokens(aiUsage.promptTokens)}</strong>
                </div>
                <div className="stat-item">
                  <span className="stat-label">누적 출력 토큰</span>
                  <strong className="stat-value">{formatTokens(aiUsage.completionTokens)}</strong>
                </div>
              </div>
              {aiUsage.totalRequests === 0 ? (
                <p className="description-text">아직 기록된 AI 사용량이 없습니다. AI 기능을 사용하면 여기에 집계됩니다.</p>
              ) : aiUsage.estimatedRequests > 0 ? (
                <p className="description-text">
                  {aiUsage.estimatedRequests}건은 서버가 토큰 수를 제공하지 않아 문자 수 기반 추정치입니다.
                </p>
              ) : null}
            </div>
          </div>
        </section>
        ) : null}


          </div>
        </section>
      </div>

      {isTypeModalOpen ? (
        <ModalBackdrop className="modal-backdrop" onRequestClose={() => setIsTypeModalOpen(false)}>
          <section ref={typeDialogRef} className="modal-card panel settings-ai-modal-card wide settings-type-modal-card" role="dialog" aria-modal="true" aria-labelledby="settings-type-modal-title" aria-describedby="settings-type-modal-description" tabIndex={-1}>
            <header className="panel-header settings-ai-modal-header"><div><h2 id="settings-type-modal-title">일정 종류 관리</h2><small id="settings-type-modal-description">이름·색상·사용 여부를 관리합니다. 기존 종류 수정은 자동 저장되며 새 종류는 생성 버튼을 사용합니다.</small></div><button type="button" className="btn btn-soft" data-dialog-initial-focus onClick={() => setIsTypeModalOpen(false)}>닫기</button></header>
            <div className="settings-ai-modal-body settings-type-card">
              <div className="settings-type-header-actions"><small>{sortedTypes.length}개 종류</small><button className="btn btn-primary" type="button" onClick={startCreateType}>새 종류 추가</button></div>
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

              {typeMessage ? <p className="success-text" role="status" aria-live="polite">{typeMessage}</p> : null}
              {typeError ? <p className="error-text" role="alert">{typeError}</p> : null}
            </form>
          </div>

            </div>
            <footer className="settings-ai-modal-footer"><span className="settings-ai-modal-footer-spacer" /><button type="button" className="btn btn-outline" onClick={() => setIsTypeModalOpen(false)}>닫기</button></footer>
          </section>
        </ModalBackdrop>
      ) : null}

      {activeSection === "ai" && isLlmModelPickerOpen ? (
        <ModalBackdrop className="modal-backdrop" onRequestClose={closeLlmModelPicker}>
          <section
            ref={llmModelPickerDialogRef}
            className="modal-card panel settings-ai-modal-card settings-model-picker-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="llm-model-picker-title"
            aria-describedby="llm-model-picker-description"
            aria-busy={llmModelListStatus === "loading"}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="panel-header settings-ai-modal-header">
              <div>
                <p className="eyebrow">AVAILABLE MODELS</p>
                <h2 id="llm-model-picker-title">LLM 모델 선택</h2>
                <small id="llm-model-picker-description">
                  서버에서 불러온 모델을 선택하면 AI 설정에 바로 저장됩니다.
                </small>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                data-dialog-initial-focus={llmModelListStatus !== "ok" ? true : undefined}
                disabled={Boolean(pendingLlmModelSelection)}
                onClick={closeLlmModelPicker}
              >
                닫기
              </button>
            </header>

            <div className="settings-ai-modal-body settings-model-picker-body">
              {llmModelListStatus === "ok" && availableLlmModels.length > 0 ? (
                <label className="settings-model-picker-search">
                  모델 검색
                  <input
                    type="search"
                    value={llmModelSearch}
                    maxLength={LLM_MAX_MODEL_ID_LENGTH}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="모델명으로 검색"
                    data-dialog-initial-focus
                    onChange={(event) => setLlmModelSearch(event.currentTarget.value)}
                  />
                </label>
              ) : null}

              <p
                className={`endpoint-status ${llmModelListStatus === "loading" ? "checking" : llmModelListStatus}`}
                role={llmModelListStatus === "error" ? "alert" : "status"}
                aria-live={llmModelListStatus === "error" ? "assertive" : "polite"}
              >
                {llmModelListMessage}
              </p>

              {llmModelPickerError ? (
                <p className="error-text" role="alert">{llmModelPickerError}</p>
              ) : null}

              {llmModelListStatus === "ok" && filteredLlmModels.length > 0 ? (
                <ul className="settings-model-picker-list" aria-label="사용 가능한 LLM 모델">
                  {filteredLlmModels.map((model) => {
                    const isSelected = model === llmModelDraft.trim();
                    const isSaving = model === pendingLlmModelSelection;
                    return (
                      <li key={model}>
                        <button
                          type="button"
                          className={`settings-model-picker-option ${isSelected ? "selected" : ""}`}
                          aria-pressed={isSelected}
                          disabled={Boolean(pendingLlmModelSelection)}
                          onClick={() => void handleSelectLlmModel(model)}
                        >
                          <span>{model}</span>
                          <small>{isSaving ? "저장 중" : isSelected ? "현재 선택" : "선택"}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {llmModelListStatus === "ok" && availableLlmModels.length > 0 && filteredLlmModels.length === 0 ? (
                <p className="empty-text">검색 조건에 맞는 모델이 없습니다.</p>
              ) : null}

              {llmModelListStatus === "ok" && availableLlmModels.length === 0 ? (
                <p className="empty-text">서버에서 조회된 모델이 없습니다. 모델명은 입력란에 직접 입력해 주세요.</p>
              ) : null}

              {llmModelListStatus === "error" ? (
                <div className="button-row compact">
                  <button type="button" className="btn btn-soft" onClick={() => void handleLoadLlmModels()}>
                    다시 불러오기
                  </button>
                </div>
              ) : null}
            </div>

            <footer className="settings-ai-modal-footer">
              <span className="description-text">
                {availableLlmModels.length > 0
                  ? `전체 ${availableLlmModels.length}개${llmModelSearch.trim() ? ` · 검색 결과 ${filteredLlmModels.length}개` : ""}`
                  : "모델을 불러오면 여기에 표시됩니다."}
              </span>
              <span className="settings-ai-modal-footer-spacer" />
              <button
                type="button"
                className="btn btn-outline"
                disabled={Boolean(pendingLlmModelSelection)}
                onClick={closeLlmModelPicker}
              >
                닫기
              </button>
            </footer>
          </section>
        </ModalBackdrop>
      ) : null}

      {activeAiSettingsDialog ? (
        <ModalBackdrop className="modal-backdrop" onRequestClose={() => setActiveAiSettingsDialog(null)}>
          <section
            ref={aiSettingsDialogRef}
            className={`modal-card panel settings-ai-modal-card settings-modal-form-card ${activeAiSettingsDialog === "actions" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-settings-dialog-title"
            aria-describedby="ai-settings-dialog-description"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="panel-header settings-ai-modal-header">
              <div>
                <h2 id="ai-settings-dialog-title">{activeAiDialogTitle}</h2>
                <small id="ai-settings-dialog-description">{activeAiDialogDescription}</small>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                data-dialog-initial-focus
                aria-label={`${activeAiDialogTitle} 닫기`}
                onClick={() => setActiveAiSettingsDialog(null)}
              >
                닫기
              </button>
            </header>

            <div
              className={`settings-ai-modal-body ${activeAiSettingsDialog === "context" ? "settings-context-card" : ""}`}
            >

              {activeAiSettingsDialog === "actions" ? (
                <>
                  <NoteAiActionManager actions={noteAiActionsDraft} onChange={setNoteAiActionsDraft} />
                  {aiActionMessage ? (
                    <p className="success-text" role="status" aria-live="polite">
                      {aiActionMessage}
                    </p>
                  ) : null}
                </>
              ) : null}

              {activeAiSettingsDialog === "context" ? (
                <>
                  <div className="form-grid two-col">
                    <label>
                      AI 컨텍스트 최대 길이
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(aiContextMaxLength)}
                        onChange={(event) => {
                          const next = Number(event.target.value.replace(/[^0-9]/g, ""));
                          void updateSetting({
                            aiContextMaxLength: Number.isFinite(next) ? next : DEFAULT_AI_CONTEXT_MAX_LENGTH,
                          });
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
                    AI 일정 추가에 사용할 맞춤 규칙
                    <textarea
                      value={userContextDraft}
                      maxLength={aiContextMaxLength}
                      onChange={(event) => setUserContextDraft(event.target.value)}
                      rows={12}
                      spellCheck={false}
                    />
                  </label>

                  <div className="settings-inline-note">
                    <span>
                      AI 일정 추가의 첫 요청부터 시스템 지침으로 전달됩니다. 현재 입력이 더 구체적이면 현재 입력을 우선합니다.
                    </span>
                  </div>

                  {userContextMessage ? (
                    <p className="success-text" role="status" aria-live="polite">
                      {userContextMessage}
                    </p>
                  ) : null}
                  {userContextError ? (
                    <p className="error-text" role="alert">
                      {userContextError}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>

            <footer className="settings-ai-modal-footer">
              {activeAiSettingsDialog === "context" ? (
                <button className="btn btn-soft" type="button" onClick={() => void handleResetUserContext()}>
                  기본값 복원
                </button>
              ) : null}

              <span className="settings-ai-modal-footer-spacer" />

              <button type="button" className="btn btn-outline" onClick={() => setActiveAiSettingsDialog(null)}>
                닫기
              </button>
              {activeAiSettingsDialog === "actions" ? (
                <button type="button" className="btn btn-primary" onClick={() => void handleSaveAiActions()}>
                  저장
                </button>
              ) : null}
              {activeAiSettingsDialog === "context" ? (
                <button className="btn btn-primary" type="button" onClick={() => void handleSaveUserContext()}>
                  맞춤 규칙 저장
                </button>
              ) : null}
            </footer>
          </section>
        </ModalBackdrop>
      ) : null}

      {pendingImport ? (
        <ModalBackdrop className="modal-backdrop" onRequestClose={closePendingImport}>
          <section
            ref={importDialogRef}
            className="modal-card panel settings-backup-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-preview-title"
            aria-describedby="import-preview-description"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="panel-header">
              <div>
                <p className="eyebrow">IMPORT PREVIEW</p>
                <h2 id="import-preview-title">백업 파일 가져오기</h2>
                <small>{pendingImport.fileName}</small>
              </div>
              <button className="btn btn-soft" type="button" disabled={isImporting} onClick={closePendingImport}>
                닫기
              </button>
            </header>

            <p id="import-preview-description" className="description-text">
              아래 데이터로 현재 내용을 모두 교체합니다. 교체 직전에 현재 데이터를 자동 백업한 뒤 가져옵니다.
            </p>
            <div className="stats-grid" aria-label="가져올 데이터 건수">
              <div className="stat-item"><span className="stat-label">나의 루틴 / 처리 이력</span><strong className="stat-value">{pendingImport.preview.routines} / {pendingImport.preview.routineOccurrences}건</strong></div>
              <div className="stat-item">
                <span className="stat-label">일정</span>
                <strong className="stat-value">{pendingImport.preview.tasks}건</strong>
              </div>
              <div className="stat-item">
                <span className="stat-label">노트</span>
                <strong className="stat-value">{pendingImport.preview.notes}건</strong>
              </div>
              <div className="stat-item">
                <span className="stat-label">프로젝트</span>
                <strong className="stat-value">{pendingImport.preview.projects}건</strong>
              </div>
              <div className="stat-item">
                <span className="stat-label">일정 종류</span>
                <strong className="stat-value">{pendingImport.preview.taskTypes}건</strong>
              </div>
              <div className="stat-item">
                <span className="stat-label">메모</span>
                <strong className="stat-value">{pendingImport.preview.memos}건</strong>
              </div>
              <div className="stat-item">
                <span className="stat-label">노트 버전</span>
                <strong className="stat-value">{pendingImport.preview.noteVersions}건</strong>
              </div>
            </div>
            <p className="error-text" role="alert">
              현재 일정 {tasks.length}건과 노트 {notes.length}건을 포함한 앱 데이터가 교체됩니다.
            </p>
            <div className="button-row">
              <button className="btn btn-danger" type="button" disabled={isImporting} onClick={() => void handleConfirmImport()}>
                {isImporting ? "백업 후 가져오는 중…" : "자동 백업 후 모두 교체"}
              </button>
              <button
                className="btn btn-outline"
                type="button"
                disabled={isImporting}
                data-dialog-initial-focus
                onClick={closePendingImport}
              >
                취소
              </button>
            </div>
          </section>
        </ModalBackdrop>
      ) : null}

      {isBackupListOpen ? (
        <ModalBackdrop className="modal-backdrop" onRequestClose={() => setIsBackupListOpen(false)}>
          <section
            ref={backupListDialogRef}
            className="modal-card panel settings-backup-modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="자동 백업 목록"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <header className="panel-header">
              <div>

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
        </ModalBackdrop>
      ) : null}
    </div>
  );
}
