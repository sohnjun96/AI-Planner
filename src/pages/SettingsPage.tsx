import { useEffect, useMemo, useRef, useState } from "react";
import { ColorSelector } from "../components/ColorSelector";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_AI_CONTEXT_MAX_LENGTH,
  DEFAULT_LLM_GEMMA_THINKING_ENABLED,
  DEFAULT_LLM_CHAT_COMPLETIONS_URL,
  DEFAULT_LLM_REASONING_EFFORT,
  DEFAULT_LLM_TEMPERATURE,
  DEFAULT_NOTE_AI_ACTIONS,
  DEFAULT_NOTE_AI_RULES,
  LLM_DEFAULT_MODEL,
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
import { generationOptionsFromSetting, isGemma4ThinkingModel, requestLlmResponse } from "../agent/llmClient";
import type { AppSetting, NoteAiAction, NoteAiRules } from "../models";
import { formatDateTime } from "../utils/date";
import { getAiUsageStats, getTodayUsage, resetAiUsage, type AiUsageStats } from "../utils/aiUsage";
import { downloadJsonBackup } from "../utils/jsonBackup";

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
type LlmReasoningEffortOption = NonNullable<AppSetting["llmReasoningEffort"]>;
type AiSettingsDialog = "actions" | "rules" | "context";

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

type SettingsSection = "overview" | "general" | "ai" | "notify" | "stats";

const NOTE_AI_TONE_LABELS: Record<NoteAiRules["tone"], string> = {
  professional: "업무형",
  neutral: "중립형",
  friendly: "친근형",
};

const NOTE_AI_DETAIL_LABELS: Record<NoteAiRules["detail"], string> = {
  concise: "간결",
  balanced: "균형",
  detailed: "상세",
};

const SETTINGS_TABS: Array<{ id: SettingsSection; label: string }> = [
  { id: "overview", label: "개요" },
  { id: "general", label: "기본·일정" },
  { id: "ai", label: "AI 설정" },
  { id: "notify", label: "알림·백업" },
  { id: "stats", label: "통계" },
];

function resolveSettingsSection(value: string | null): SettingsSection {
  if (value === "types") {
    return "general";
  }
  if (value === "noteAi" || value === "context") {
    return "ai";
  }
  return SETTINGS_TABS.some((tab) => tab.id === value) ? (value as SettingsSection) : "overview";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    setting,
    updateSetting,
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
    notes,
    noteVersions,
    noteTaskLinks,
  } = useAppData();

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport>();
  const [isImporting, setIsImporting] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const [isBackupListOpen, setIsBackupListOpen] = useState(false);
  const [activeAiSettingsDialog, setActiveAiSettingsDialog] = useState<AiSettingsDialog | null>(null);
  const [userContextDraft, setUserContextDraft] = useState("");
  const [userContextMessage, setUserContextMessage] = useState("");
  const [userContextError, setUserContextError] = useState("");
  const [aiConnectionStatus, setAiConnectionStatus] = useState<AiConnectionStatus>("idle");
  const [aiConnectionMessage, setAiConnectionMessage] = useState("연결 상태를 아직 확인하지 않았습니다.");
  const [noteAiActionsDraft, setNoteAiActionsDraft] = useState<NoteAiAction[]>(
    () => setting.noteAiActions ?? DEFAULT_NOTE_AI_ACTIONS,
  );
  const [aiActionMessage, setAiActionMessage] = useState("");
  const [noteAiRulesDraft, setNoteAiRulesDraft] = useState<NoteAiRules>(
    () => ({ ...DEFAULT_NOTE_AI_RULES, ...(setting.noteAiRules ?? {}) }),
  );
  const [noteAiRulesMessage, setNoteAiRulesMessage] = useState("");
  const [activeSection, setActiveSection] = useState<SettingsSection>(() => {
    return resolveSettingsSection(searchParams.get("section"));
  });
  const { isReady: isJsonBackupStatusReady, status: jsonBackupStatus } = useJsonBackupStatus();

  const [typeForm, setTypeForm] = useState<TypeFormState>(() => createEmptyTypeForm());
  const [typeMessage, setTypeMessage] = useState("");
  const [typeError, setTypeError] = useState("");
  const typeAutoSaveSnapshotRef = useRef("");
  const lastTypeIdRef = useRef<string | undefined>(undefined);

  function closePendingImport() {
    if (!isImporting) {
      setPendingImport(undefined);
      setMessage("");
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
    isOpen: activeSection === "ai" && activeAiSettingsDialog !== null,
    onClose: () => setActiveAiSettingsDialog(null),
  });

  const sortedTypes = useMemo(() => [...taskTypes].sort((a, b) => a.order - b.order), [taskTypes]);
  const aiContextMaxLength = setting.aiContextMaxLength ?? DEFAULT_AI_CONTEXT_MAX_LENGTH;
  const userContextUsedLength = Math.min(userContextDraft.length, aiContextMaxLength);
  const savedUserContextLength = Math.min(userContext.markdown.length, aiContextMaxLength);
  const isGemma4ThinkingAvailable = isGemma4ThinkingModel(setting.llmModel ?? LLM_DEFAULT_MODEL);
  const savedNoteAiActions = setting.noteAiActions ?? DEFAULT_NOTE_AI_ACTIONS;
  const savedNoteAiRules = { ...DEFAULT_NOTE_AI_RULES, ...(setting.noteAiRules ?? {}) };
  const savedPreservationRuleCount = [
    savedNoteAiRules.preserveFacts,
    savedNoteAiRules.preserveMarkdown,
    savedNoteAiRules.preserveChecklists,
  ].filter(Boolean).length;
  const savedActionPreview = savedNoteAiActions
    .slice(0, 3)
    .map((action) => action.label)
    .join(" · ");
  const activeAiDialogTitle =
    activeAiSettingsDialog === "actions"
      ? "노트 AI 편집 기능"
      : activeAiSettingsDialog === "rules"
        ? "노트 AI 공통 규칙"
        : "AI 맞춤 규칙";
  const activeAiDialogEyebrow =
    activeAiSettingsDialog === "actions"
      ? "NOTE AI"
      : activeAiSettingsDialog === "rules"
        ? "NOTE AI POLICY"
        : "USER CONTEXT";
  const activeAiDialogDescription =
    activeAiSettingsDialog === "actions"
      ? "노트 편집 화면과 우클릭 메뉴에 표시할 AI 기능과 프롬프트를 관리합니다."
      : activeAiSettingsDialog === "rules"
        ? "노트 다듬기·선택 편집·요약·통합에 공통으로 적용할 규칙을 설정합니다."
        : "AI가 일정 요청을 해석할 때 참고할 개인 규칙을 관리합니다.";

  useEffect(() => {
    setActiveSection(resolveSettingsSection(searchParams.get("section")));
  }, [searchParams]);

  useEffect(() => {
    if (activeSection !== "ai") {
      setActiveAiSettingsDialog(null);
    }
  }, [activeSection]);

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

  function selectSection(section: SettingsSection) {
    setActiveAiSettingsDialog(null);
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
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // 월요일 기준
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
  }, [tasks]);

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

  useEffect(() => {
    setNoteAiRulesDraft({ ...DEFAULT_NOTE_AI_RULES, ...(setting.noteAiRules ?? {}) });
  }, [setting.noteAiRules]);

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

  async function handleSaveNoteAiRules() {
    setNoteAiRulesMessage("");
    try {
      await updateSetting({
        noteAiRules: {
          ...noteAiRulesDraft,
          customInstructions: noteAiRulesDraft.customInstructions.trim().slice(0, 1000),
        },
      });
      setNoteAiRulesMessage("노트 AI 공통 규칙을 저장했습니다.");
    } catch (saveError) {
      setNoteAiRulesMessage(saveError instanceof Error ? saveError.message : "저장에 실패했습니다.");
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
      const content = await file.text();
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

  async function handleConfirmImport() {
    if (!pendingImport || isImporting) {
      return;
    }

    setError("");
    setMessage("");
    setIsImporting(true);
    let backupCreated = false;
    try {
      await createAutoBackup("JSON 가져오기 직전");
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

  async function handleCheckAiConnection() {
    const startedAt = performance.now();
    setAiConnectionStatus("checking");
    setAiConnectionMessage("AI 연결을 확인하는 중입니다.");

    try {
      const response = await requestLlmResponse({
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        model: setting.llmModel ?? LLM_DEFAULT_MODEL,
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
          <p className="description-text">기본 환경과 일정 종류, AI, 알림·백업을 성격별로 모아 관리합니다.</p>
        </div>
        <div className="settings-hero-actions">
          <div className="settings-json-export-control">
            <button className="btn btn-primary" type="button" onClick={() => void handleExport()} disabled={isExporting}>
              {isExporting ? "내보내는 중…" : "JSON 내보내기"}
            </button>
            <small className="settings-json-export-status">
              마지막 내보내기:{" "}
              {isJsonBackupStatusReady
                ? jsonBackupStatus.lastExportedAt
                  ? formatDateTime(jsonBackupStatus.lastExportedAt, setting.timeFormat)
                  : "아직 없음"
                : "확인 중…"}
            </small>
          </div>
          <label className="btn btn-soft file-upload">
            JSON 가져오기
            <input type="file" accept=".json,application/json" onChange={handleImport} />
          </label>
        </div>
      </section>

      {message ? (
        <p className="success-text" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}

      <nav className="settings-tabs" aria-label="설정 분류">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`settings-tab ${activeSection === tab.id ? "active" : ""}`}
            aria-pressed={activeSection === tab.id}
            onClick={() => selectSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeSection === "overview" ? (
        <section className="settings-overview-grid" aria-label="설정 요약">
          <button type="button" className="settings-summary-card" onClick={() => selectSection("general")}>
            <span>기본·일정</span>
            <strong>
              {setting.weekStartsOn === "mon" ? "월" : "일"} 시작 · {setting.timeFormat === "24h" ? "24시간제" : "12시간제"}
            </strong>
            <small>일정 종류 {sortedTypes.length}개</small>
          </button>
          <button type="button" className="settings-summary-card" onClick={() => selectSection("ai")}>
            <span>AI 설정</span>
            <strong>
              {aiConnectionStatus === "checking"
                ? "확인 중"
                : aiConnectionStatus === "ok"
                  ? "정상"
                  : aiConnectionStatus === "error"
                    ? "실패"
                    : "미확인"}
            </strong>
            <small>노트 기능 {noteAiActionsDraft.length}개 · 맞춤 규칙 {userContextUsedLength}자</small>
          </button>
          <button type="button" className="settings-summary-card" onClick={() => selectSection("notify")}>
            <span>알림·백업</span>
            <strong>{setting.notificationsEnabled ? `${setting.notifyBeforeMinutes ?? 30}분 전` : "꺼짐"}</strong>
            <small>{setting.autoBackupEnabled ? `자동 백업 ${autoBackups.length}개 보관` : "수동 백업"}</small>
          </button>
          <button type="button" className="settings-summary-card" onClick={() => selectSection("stats")}>
            <span>사용 통계</span>
            <strong>
              일정 {taskStats.total} · 노트 {noteStats.total}
            </strong>
            <small>프로젝트 {projects.length}개</small>
          </button>
        </section>
      ) : null}

      <div className="settings-section-host">
        {activeSection === "stats" ? (
        <section className="settings-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">STATS</p>
              <h3>사용 통계</h3>
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

        {activeSection === "general" ? (
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
        ) : null}

        {activeSection === "ai" ? (
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
        <section className="settings-card settings-generation-options-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">MODEL OPTIONS</p>
              <h3>응답 생성 옵션</h3>
            </div>
          </header>

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
            일부 서버나 모델은 이 옵션을 지원하지 않을 수 있습니다. 변경 후 위의 연결 확인으로 호환성을 확인하세요.
          </p>
        </section>
        ) : null}

        {activeSection === "ai" ? (
        <section className="settings-card settings-ai-management-card">
          <header className="settings-card-header">
            <div>
              <p className="eyebrow">AI FEATURES</p>
              <h3>기능별 세부 설정</h3>
            </div>
          </header>

          <p className="description-text">
            자주 바꾸지 않는 긴 설정은 목적별 편집창에서 관리합니다.
          </p>

          <div className="settings-ai-management-list">
            <div className="settings-ai-management-row">
              <div>
                <strong>노트 AI 편집 기능</strong>
                <p>
                  {savedNoteAiActions.length}개 기능
                  {savedActionPreview ? ` · ${savedActionPreview}${savedNoteAiActions.length > 3 ? " 외" : ""}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                aria-label="노트 AI 편집 기능 편집"
                onClick={() => {
                  setAiActionMessage("");
                  setActiveAiSettingsDialog("actions");
                }}
              >
                편집
              </button>
            </div>

            <div className="settings-ai-management-row">
              <div>
                <strong>노트 AI 공통 규칙</strong>
                <p>
                  {NOTE_AI_TONE_LABELS[savedNoteAiRules.tone]} · {NOTE_AI_DETAIL_LABELS[savedNoteAiRules.detail]} · 보존 규칙 {savedPreservationRuleCount}/3
                </p>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                aria-label="노트 AI 공통 규칙 편집"
                onClick={() => {
                  setNoteAiRulesMessage("");
                  setActiveAiSettingsDialog("rules");
                }}
              >
                편집
              </button>
            </div>

            <div className="settings-ai-management-row">
              <div>
                <strong>AI 맞춤 규칙</strong>
                <p>{savedUserContextLength} / {aiContextMaxLength}자 · 일정 해석에 적용</p>
              </div>
              <button
                type="button"
                className="btn btn-soft"
                aria-label="AI 맞춤 규칙 편집"
                onClick={() => {
                  setUserContextMessage("");
                  setUserContextError("");
                  setActiveAiSettingsDialog("context");
                }}
              >
                편집
              </button>
            </div>
          </div>
        </section>
        ) : null}

        {activeSection === "notify" ? (
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

          <div className="settings-inline-note">
            <span>
              자동 백업은 이 브라우저 안에 보관됩니다. 컴퓨터에 별도 파일을 남기려면 화면 위의 JSON 내보내기를 사용하세요.
            </span>
          </div>

          <div className="settings-backup-actions">
            <button className="btn btn-primary" type="button" onClick={() => void handleCreateManualBackup()}>
              앱 내부 백업 생성
            </button>
            <button className="btn btn-soft" type="button" onClick={openBackupList}>
              자동 백업 목록 보기
            </button>
          </div>

          {backupMessage ? <p className="success-text" role="status" aria-live="polite">{backupMessage}</p> : null}
          {backupError ? <p className="error-text" role="alert">{backupError}</p> : null}

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
        ) : null}

        {activeSection === "general" ? (
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

              {typeMessage ? <p className="success-text" role="status" aria-live="polite">{typeMessage}</p> : null}
              {typeError ? <p className="error-text" role="alert">{typeError}</p> : null}
            </form>
          </div>
        </section>
        ) : null}
      </div>

      {activeSection === "ai" && activeAiSettingsDialog ? (
        <div className="modal-backdrop" onClick={() => setActiveAiSettingsDialog(null)}>
          <section
            ref={aiSettingsDialogRef}
            className={`modal-card panel settings-ai-modal-card ${activeAiSettingsDialog === "actions" ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-settings-dialog-title"
            aria-describedby="ai-settings-dialog-description"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="panel-header settings-ai-modal-header">
              <div>
                <p className="eyebrow">{activeAiDialogEyebrow}</p>
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

              {activeAiSettingsDialog === "rules" ? (
                <>
                  <div className="form-grid two-col">
                    <label>
                      기본 문체
                      <select
                        value={noteAiRulesDraft.tone}
                        onChange={(event) =>
                          setNoteAiRulesDraft((current) => ({
                            ...current,
                            tone: event.target.value as NoteAiRules["tone"],
                          }))
                        }
                      >
                        <option value="professional">업무형 — 명확하고 정돈된 표현</option>
                        <option value="neutral">중립형 — 담백한 표현</option>
                        <option value="friendly">친근형 — 부드럽고 협업적인 표현</option>
                      </select>
                    </label>

                    <label>
                      기본 결과 분량
                      <select
                        value={noteAiRulesDraft.detail}
                        onChange={(event) =>
                          setNoteAiRulesDraft((current) => ({
                            ...current,
                            detail: event.target.value as NoteAiRules["detail"],
                          }))
                        }
                      >
                        <option value="concise">간결 — 중복 표현을 줄인 핵심 결과</option>
                        <option value="balanced">균형 — 바로 활용할 수 있는 적정 분량</option>
                        <option value="detailed">상세 — 근거가 있는 맥락과 단계까지 유지</option>
                      </select>
                    </label>
                  </div>

                  <div className="note-ai-rule-toggles" role="group" aria-label="노트 AI 보존 규칙">
                    <label className="checkbox-inline settings-toggle-row">
                      <input
                        type="checkbox"
                        checked={noteAiRulesDraft.preserveFacts}
                        onChange={(event) =>
                          setNoteAiRulesDraft((current) => ({ ...current, preserveFacts: event.target.checked }))
                        }
                      />
                      사실·수치·고유명사 보존
                      <small>근거 없는 내용은 추가하지 않고, 불확실한 항목은 그대로 둡니다.</small>
                    </label>
                    <label className="checkbox-inline settings-toggle-row">
                      <input
                        type="checkbox"
                        checked={noteAiRulesDraft.preserveMarkdown}
                        onChange={(event) =>
                          setNoteAiRulesDraft((current) => ({ ...current, preserveMarkdown: event.target.checked }))
                        }
                      />
                      마크다운 구조 보존
                      <small>제목·목록·표·링크 같은 기존 형식을 요청 없이는 평면화하지 않습니다.</small>
                    </label>
                    <label className="checkbox-inline settings-toggle-row">
                      <input
                        type="checkbox"
                        checked={noteAiRulesDraft.preserveChecklists}
                        onChange={(event) =>
                          setNoteAiRulesDraft((current) => ({ ...current, preserveChecklists: event.target.checked }))
                        }
                      />
                      체크리스트 상태 보존
                      <small>할 일과 완료 상태를 요청 없이 추가·삭제·완료 처리하지 않습니다.</small>
                    </label>
                  </div>

                  <label className="note-ai-custom-instructions">
                    추가 지시 <small>{noteAiRulesDraft.customInstructions.length} / 1000자</small>
                    <textarea
                      value={noteAiRulesDraft.customInstructions}
                      maxLength={1000}
                      onChange={(event) =>
                        setNoteAiRulesDraft((current) => ({ ...current, customInstructions: event.target.value }))
                      }
                      rows={4}
                      placeholder="예: 회의록은 결정 사항·담당자·기한을 먼저 정리하고, 담당자가 없으면 [담당자 확인]으로 남겨줘."
                      spellCheck={false}
                    />
                  </label>

                  {noteAiRulesMessage ? (
                    <p className="success-text" role="status" aria-live="polite">
                      {noteAiRulesMessage}
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
                    AI가 일정 해석에 사용할 맞춤 규칙
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
                      AI 일정 추가 시 이 내용이 개인 규칙으로 전달됩니다. 현재 입력이 더 구체적이면 현재 입력을 우선합니다.
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
              {activeAiSettingsDialog === "rules" ? (
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => setNoteAiRulesDraft({ ...DEFAULT_NOTE_AI_RULES })}
                >
                  기본값으로 되돌리기
                </button>
              ) : null}
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
              {activeAiSettingsDialog === "rules" ? (
                <button type="button" className="btn btn-primary" onClick={() => void handleSaveNoteAiRules()}>
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
        </div>
      ) : null}

      {pendingImport ? (
        <div className="modal-backdrop" onClick={closePendingImport}>
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
        </div>
      ) : null}

      {isBackupListOpen ? (
        <div className="modal-backdrop" onClick={() => setIsBackupListOpen(false)}>
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
