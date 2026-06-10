import { useEffect, useMemo, useRef, useState } from "react";
import { runScheduleAgent } from "../agent/scheduleAgent";
import type {
  AgentConversationMessage,
  AgentCreateTaskOperation,
  AgentDeleteTaskOperation,
  AgentOperation,
  AgentProposal,
  AgentUpdateTaskOperation,
} from "../agent/scheduleAgent";
import { DEFAULT_LLM_CHAT_COMPLETIONS_URL, STATUS_LABELS } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";
import { formatDateTime } from "../utils/date";

interface AiAssistantWorkspaceProps {
  compact?: boolean;
  showEndpointInfo?: boolean;
  directApply?: boolean;
  hideInitialResult?: boolean;
  resultPresentation?: "inline" | "modal";
  showRetryButton?: boolean;
  title?: string;
  subtitle?: string;
  inputLabel?: string;
  placeholder?: string;
  quickPrompts?: string[];
  className?: string;
  initialDraft?: string;
  onApplied?: () => void;
  onRequestClose?: () => void;
}

type EndpointStatus = "checking" | "ok" | "error";

const FIELD_LABELS: Record<string, string> = {
  title: "제목",
  content: "내용",
  taskTypeId: "종류",
  projectId: "프로젝트",
  status: "상태",
  startAt: "시작",
  endAt: "종료",
  isMajor: "중요",
};

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "NOT_DONE" || value === "ON_HOLD" || value === "DONE";
}

function toTaskInput(task: Task): TaskFormInput {
  return {
    title: task.title,
    content: task.content,
    taskTypeId: task.taskTypeId,
    projectId: task.projectId,
    status: task.status,
    startAt: task.startAt,
    endAt: task.endAt,
    isMajor: task.isMajor,
  };
}

function isValidIsoDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

function formatOperationLabel(operation: AgentOperation, taskTitle?: string): string {
  if (operation.action === "create_task") {
    return `일정 추가: ${operation.title}`;
  }
  if (operation.action === "update_task") {
    return `일정 수정: ${taskTitle ?? operation.taskId}`;
  }
  return `일정 삭제: ${taskTitle ?? operation.taskId}`;
}

function getOperationActionMeta(operation: AgentOperation): { label: string; tone: string } {
  if (operation.action === "create_task") {
    return { label: "추가", tone: "create" };
  }
  if (operation.action === "update_task") {
    return { label: "수정", tone: "update" };
  }
  return { label: "삭제", tone: "delete" };
}

function toFriendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "AI 처리 중 오류가 발생했습니다.";
  const lower = raw.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econnrefused")) {
    return `${raw}\nLLM 서버 연결 상태를 확인한 뒤 다시 시도해 주세요.`;
  }

  return raw;
}

async function probeEndpoint(endpoint: string, apiKey: string, model: string): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, 5000);

  try {
    const response = await fetch(endpoint.trim() || DEFAULT_LLM_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: model.trim() || "gpt-4o-mini",
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        temperature: 0,
        max_tokens: 2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`연결 실패 (${response.status}): ${body.slice(0, 120)}`);
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

function describeChangeValue(key: string, value: unknown, timeFormat: "24h" | "12h"): string {
  if (value === null || value === undefined || value === "") {
    return "비움";
  }
  if ((key === "startAt" || key === "endAt") && typeof value === "string" && isValidIsoDate(value)) {
    return formatDateTime(value, timeFormat);
  }
  if (key === "status" && isTaskStatus(value)) {
    return STATUS_LABELS[value];
  }
  if (typeof value === "boolean") {
    return value ? "예" : "아니오";
  }
  return String(value);
}

function formatOperationTimeRange(startAt: string, endAt: string | undefined, timeFormat: "24h" | "12h"): string {
  const startText = formatDateTime(startAt, timeFormat);
  if (!endAt) {
    return startText;
  }
  return `${startText} - ${formatDateTime(endAt, timeFormat)}`;
}

function focusTextareaAtEnd(textarea: HTMLTextAreaElement | null, value?: string) {
  if (!textarea) {
    return;
  }

  const cursor = value?.length ?? textarea.value.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
}

export function AiAssistantWorkspace({
  compact = false,
  showEndpointInfo = true,
  directApply = false,
  hideInitialResult = false,
  resultPresentation = "inline",
  showRetryButton = true,
  title = "AI 일정 입력",
  subtitle = "요청, 질문, 초안 검토를 한 공간에서 처리합니다.",
  inputLabel = "요청 입력",
  placeholder = "예: 내일 오전 10시에 보고서 제출 일정을 추가해줘. 프로젝트는 일반, 종류는 제출.",
  quickPrompts = [],
  className = "",
  initialDraft = "",
  onApplied,
  onRequestClose,
}: AiAssistantWorkspaceProps) {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask } = useAppData();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(initialDraft);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [lastAssistantMessage, setLastAssistantMessage] = useState(
    "일정 요청을 입력하면 AI가 필요한 질문과 초안, 변경안을 정리해서 보여줍니다.",
  );
  const [lastQuestion, setLastQuestion] = useState("");
  const [pendingProposal, setPendingProposal] = useState<AgentProposal | undefined>(undefined);
  const [selectedOperationIndexes, setSelectedOperationIndexes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");
  const [applyResult, setApplyResult] = useState("");
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus>("checking");
  const [endpointStatusMessage, setEndpointStatusMessage] = useState("연결 확인 중");

  const taskMap = useMemo(() => Object.fromEntries(tasks.map((task) => [task.id, task])), [tasks]);
  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const taskTypeMap = useMemo(() => Object.fromEntries(taskTypes.map((taskType) => [taskType.id, taskType])), [taskTypes]);
  const selectedOperationSet = useMemo(() => new Set(selectedOperationIndexes), [selectedOperationIndexes]);
  const hasOperations = (pendingProposal?.operations.length ?? 0) > 0;
  const hasVisibleResult = Boolean(pendingProposal || lastQuestion || error || applyResult || isLoading);
  const canApplyProposalWithEnter = Boolean(
    pendingProposal && hasOperations && selectedOperationIndexes.length > 0 && !isApplying,
  );

  const conversationContext = useMemo<AgentConversationMessage[]>(() => {
    if (!lastUserMessage || !lastAssistantMessage) {
      return [];
    }
    return [
      { role: "user", content: lastUserMessage },
      { role: "assistant", content: lastAssistantMessage },
    ];
  }, [lastAssistantMessage, lastUserMessage]);

  useEffect(() => {
    if (!pendingProposal) {
      setSelectedOperationIndexes([]);
      return;
    }

    setSelectedOperationIndexes(pendingProposal.operations.map((_, index) => index));
  }, [pendingProposal]);

  useEffect(() => {
    let isMounted = true;
    setEndpointStatus("checking");
    setEndpointStatusMessage("연결 확인 중");

    void probeEndpoint(setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL, setting.llmApiKey ?? "", setting.llmModel ?? "")
      .then(() => {
        if (!isMounted) {
          return;
        }
        setEndpointStatus("ok");
        setEndpointStatusMessage("정상");
      })
      .catch((probeError) => {
        if (!isMounted) {
          return;
        }
        setEndpointStatus("error");
        setEndpointStatusMessage(toFriendlyError(probeError));
      });

    return () => {
      isMounted = false;
    };
  }, [setting.llmApiKey, setting.llmEndpoint, setting.llmModel]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      focusTextareaAtEnd(textareaRef.current);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    setDraft(initialDraft);
    const frame = window.requestAnimationFrame(() => {
      focusTextareaAtEnd(textareaRef.current, initialDraft);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [initialDraft]);

  useEffect(() => {
    if (!pendingProposal) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusTextareaAtEnd(textareaRef.current);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pendingProposal]);

  async function handleSend(messageOverride?: string) {
    const userMessage = (messageOverride ?? draft).trim();
    if (!userMessage || isLoading) {
      return;
    }

    setError("");
    setApplyResult("");
    setLastQuestion("");
    setPendingProposal(undefined);
    if (!messageOverride) {
      setDraft("");
    }
    setIsLoading(true);

    try {
      const result = await runScheduleAgent({
        userMessage,
        conversation: conversationContext,
        tasks,
        projects,
        taskTypes,
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
      });

      setLastUserMessage(userMessage);
      setLastAssistantMessage(result.assistantMessage);
      setLastQuestion(result.needsUserInput ? result.question ?? "추가 정보가 필요합니다." : "");
      setPendingProposal(result.proposal);
      setEndpointStatus("ok");
      setEndpointStatusMessage("정상");
    } catch (runError) {
      const message = toFriendlyError(runError);
      setError(message);
      setLastAssistantMessage(`요청 처리에 실패했습니다: ${message}`);
      setLastQuestion("");
      setEndpointStatus("error");
      setEndpointStatusMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  async function applyCreateOperation(operation: AgentCreateTaskOperation): Promise<void> {
    if (!projectMap[operation.projectId]) {
      throw new Error(`프로젝트를 찾을 수 없습니다: ${operation.projectId}`);
    }
    if (!taskTypeMap[operation.taskTypeId]) {
      throw new Error(`종류를 찾을 수 없습니다: ${operation.taskTypeId}`);
    }
    if (!isValidIsoDate(operation.startAt)) {
      throw new Error("시작 시간이 올바른 날짜 형식이 아닙니다.");
    }
    if (operation.endAt && !isValidIsoDate(operation.endAt)) {
      throw new Error("종료 시간이 올바른 날짜 형식이 아닙니다.");
    }
    if (operation.endAt && new Date(operation.endAt).getTime() < new Date(operation.startAt).getTime()) {
      throw new Error("종료 시간이 시작 시간보다 빠릅니다.");
    }

    await createTask({
      title: operation.title,
      content: operation.content,
      taskTypeId: operation.taskTypeId,
      projectId: operation.projectId,
      status: operation.status,
      startAt: operation.startAt,
      endAt: operation.endAt,
      isMajor: operation.isMajor,
    });
  }

  async function applyUpdateOperation(operation: AgentUpdateTaskOperation): Promise<void> {
    const target = taskMap[operation.taskId];
    if (!target) {
      throw new Error(`수정할 일정을 찾을 수 없습니다: ${operation.taskId}`);
    }

    const nextInput = toTaskInput(target);
    const { changes } = operation;

    if (typeof changes.title === "string") {
      nextInput.title = changes.title;
    }
    if (typeof changes.content === "string") {
      nextInput.content = changes.content;
    }
    if (typeof changes.taskTypeId === "string") {
      if (!taskTypeMap[changes.taskTypeId]) {
        throw new Error(`종류를 찾을 수 없습니다: ${changes.taskTypeId}`);
      }
      nextInput.taskTypeId = changes.taskTypeId;
    }
    if (typeof changes.projectId === "string") {
      if (!projectMap[changes.projectId]) {
        throw new Error(`프로젝트를 찾을 수 없습니다: ${changes.projectId}`);
      }
      nextInput.projectId = changes.projectId;
    }
    if (isTaskStatus(changes.status)) {
      nextInput.status = changes.status;
    }
    if (typeof changes.startAt === "string") {
      if (!isValidIsoDate(changes.startAt)) {
        throw new Error("시작 시간이 올바른 날짜 형식이 아닙니다.");
      }
      nextInput.startAt = changes.startAt;
    }
    if (Object.hasOwn(changes, "endAt")) {
      if (changes.endAt !== null && typeof changes.endAt !== "string") {
        throw new Error("종료 시간 형식이 올바르지 않습니다.");
      }
      if (typeof changes.endAt === "string" && !isValidIsoDate(changes.endAt)) {
        throw new Error("종료 시간이 올바른 날짜 형식이 아닙니다.");
      }
      nextInput.endAt = changes.endAt ?? undefined;
    }
    if (typeof changes.isMajor === "boolean") {
      nextInput.isMajor = changes.isMajor;
    }

    if (nextInput.endAt && new Date(nextInput.endAt).getTime() < new Date(nextInput.startAt).getTime()) {
      throw new Error("종료 시간이 시작 시간보다 빠릅니다.");
    }

    await updateTask(operation.taskId, nextInput);
  }

  async function applyDeleteOperation(operation: AgentDeleteTaskOperation): Promise<void> {
    if (!taskMap[operation.taskId]) {
      throw new Error(`삭제할 일정을 찾을 수 없습니다: ${operation.taskId}`);
    }
    await removeTask(operation.taskId);
  }

  async function applyOperation(operation: AgentOperation): Promise<void> {
    if (operation.action === "create_task") {
      await applyCreateOperation(operation);
      return;
    }
    if (operation.action === "update_task") {
      await applyUpdateOperation(operation);
      return;
    }
    await applyDeleteOperation(operation);
  }

  async function handleApplyProposal() {
    if (!pendingProposal || isApplying) {
      return;
    }

    const indexesToApply = pendingProposal.operations
      .map((_, index) => index)
      .filter((index) => selectedOperationSet.has(index));

    if (indexesToApply.length === 0) {
      setError("반영할 항목을 하나 이상 선택해 주세요.");
      return;
    }

    setError("");
    setIsApplying(true);

    const successLogs: string[] = [];
    const failedLogs: string[] = [];
    const failedIndexSet = new Set<number>();

    for (const index of indexesToApply) {
      const operation = pendingProposal.operations[index];
      if (!operation) {
        continue;
      }

      const taskTitle =
        operation.action === "create_task" ? operation.title : taskMap[operation.taskId]?.title ?? operation.taskId;

      try {
        await applyOperation(operation);
        successLogs.push(formatOperationLabel(operation, taskTitle));
      } catch (applyError) {
        const message = applyError instanceof Error ? applyError.message : "반영 실패";
        failedLogs.push(`${formatOperationLabel(operation, taskTitle)} (${message})`);
        failedIndexSet.add(index);
      }
    }

    const resultTextParts = [
      successLogs.length > 0 ? `성공 ${successLogs.length}건` : "",
      failedLogs.length > 0 ? `실패 ${failedLogs.length}건` : "",
    ].filter(Boolean);

    const resultText = resultTextParts.length > 0 ? resultTextParts.join(", ") : "반영 결과가 없습니다.";
    setApplyResult(resultText);
    setLastAssistantMessage(
      [
        `변경안 반영 결과: ${resultText}`,
        successLogs.length > 0 ? `성공 목록: ${successLogs.join(", ")}` : "",
        failedLogs.length > 0 ? `실패 목록: ${failedLogs.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    const remainingOperations = pendingProposal.operations.filter((_, index) => {
      if (!selectedOperationSet.has(index)) {
        return true;
      }
      return failedIndexSet.has(index);
    });

    if (remainingOperations.length === 0) {
      setPendingProposal(undefined);
      setSelectedOperationIndexes([]);
    } else {
      const nextProposal: AgentProposal = {
        ...pendingProposal,
        summary: `남은 변경안 ${remainingOperations.length}건`,
        operations: remainingOperations,
      };
      setPendingProposal(nextProposal);
      setSelectedOperationIndexes(nextProposal.operations.map((_, index) => index));
    }

    setIsApplying(false);
    onApplied?.();
  }

  function renderOperation(operation: AgentOperation, index: number) {
    const isSelected = selectedOperationSet.has(index);
    const actionMeta = getOperationActionMeta(operation);
    const toggleSelection = (checked: boolean) => {
      setSelectedOperationIndexes((prev) => {
        if (checked) {
          return [...prev, index].sort((a, b) => a - b);
        }
        return prev.filter((item) => item !== index);
      });
    };

    if (operation.action === "create_task") {
      const projectName = projectMap[operation.projectId]?.name ?? operation.projectId;
      const taskTypeName = taskTypeMap[operation.taskTypeId]?.name ?? operation.taskTypeId;
      return (
        <li key={`proposal-${index}`} className={`proposal-card ${actionMeta.tone} ${isSelected ? "selected" : ""}`}>
          <label className="proposal-item-toggle">
            <input type="checkbox" checked={isSelected} onChange={(event) => toggleSelection(event.target.checked)} />
            <span className="proposal-checkmark" aria-hidden="true" />
            <span className="proposal-card-body">
              <span className="proposal-card-topline">
                <span className={`proposal-action-pill ${actionMeta.tone}`}>{actionMeta.label}</span>
                <span className={`status-badge ${operation.status.toLowerCase()}`}>{STATUS_LABELS[operation.status]}</span>
                {operation.isMajor ? <span className="major-tag">중요</span> : null}
              </span>
              <strong>{operation.title}</strong>
              <span className="proposal-time-chip">{formatOperationTimeRange(operation.startAt, operation.endAt, setting.timeFormat)}</span>
              <span className="proposal-meta-grid">
                <span>{projectName}</span>
                <span>{taskTypeName}</span>
              </span>
              {operation.content ? <small>{operation.content}</small> : null}
            </span>
          </label>
        </li>
      );
    }

    if (operation.action === "update_task") {
      const taskTitle = taskMap[operation.taskId]?.title ?? operation.taskId;
      const changeText = Object.entries(operation.changes)
        .map(([key, value]) => `${FIELD_LABELS[key] ?? key}: ${describeChangeValue(key, value, setting.timeFormat)}`)
        .join(" · ");
      return (
        <li key={`proposal-${index}`} className={`proposal-card ${actionMeta.tone} ${isSelected ? "selected" : ""}`}>
          <label className="proposal-item-toggle">
            <input type="checkbox" checked={isSelected} onChange={(event) => toggleSelection(event.target.checked)} />
            <span className="proposal-checkmark" aria-hidden="true" />
            <span className="proposal-card-body">
              <span className="proposal-card-topline">
                <span className={`proposal-action-pill ${actionMeta.tone}`}>{actionMeta.label}</span>
              </span>
              <strong>{taskTitle}</strong>
              <small>{changeText || "변경 필드 없음"}</small>
            </span>
          </label>
        </li>
      );
    }

    const taskTitle = taskMap[operation.taskId]?.title ?? operation.taskId;
    return (
      <li key={`proposal-${index}`} className={`proposal-card ${actionMeta.tone} ${isSelected ? "selected" : ""}`}>
        <label className="proposal-item-toggle">
          <input type="checkbox" checked={isSelected} onChange={(event) => toggleSelection(event.target.checked)} />
          <span className="proposal-checkmark" aria-hidden="true" />
          <span className="proposal-card-body">
            <span className="proposal-card-topline">
              <span className={`proposal-action-pill ${actionMeta.tone}`}>{actionMeta.label}</span>
            </span>
            <strong>{taskTitle}</strong>
            {operation.reason ? <small>{operation.reason}</small> : null}
          </span>
        </label>
      </li>
    );
  }

  const shouldShowResultCard = !hideInitialResult || hasVisibleResult;
  const responseText = isLoading ? "요청을 읽고 일정 초안을 만드는 중입니다." : lastAssistantMessage;
  const operationCount = pendingProposal?.operations.length ?? 0;
  const resultCard = shouldShowResultCard ? (
    <div className={`ai-result-card ${hasVisibleResult ? "has-output" : ""}`} aria-live="polite">
      {lastQuestion ? (
        <div className="ai-question-block">
          <span className="badge-pill danger">질문</span>
          <p>{lastQuestion}</p>
        </div>
      ) : null}

      {pendingProposal ? (
        <div className="proposal-block compact-review">
          <div className="proposal-summary-row">
            <div>
              <span className="badge-pill">일정 초안</span>
              <p className="description-text">{pendingProposal.summary}</p>
            </div>
            <div className="proposal-count-card" aria-label="선택한 초안 수">
              <strong>{selectedOperationIndexes.length}</strong>
              <span>/ {operationCount} 선택</span>
            </div>
            {hasOperations ? (
              <div className="button-row compact">
                <button
                  className="btn btn-soft"
                  type="button"
                  onClick={() => setSelectedOperationIndexes(pendingProposal.operations.map((_, index) => index))}
                >
                  전체 선택
                </button>
                <button className="btn btn-soft" type="button" onClick={() => setSelectedOperationIndexes([])}>
                  해제
                </button>
              </div>
            ) : null}
          </div>

          {hasOperations ? (
            <ul className="proposal-list compact-list">{pendingProposal.operations.map(renderOperation)}</ul>
          ) : (
            <p className="empty-text">AI가 실제 일정 항목 없이 요약만 반환했습니다. 요청을 더 구체적으로 다시 입력해 주세요.</p>
          )}

          {hasOperations ? (
            <div className="button-row proposal-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={isApplying || selectedOperationIndexes.length === 0}
                onClick={() => void handleApplyProposal()}
              >
                {isApplying
                  ? "등록 중"
                  : directApply
                    ? `선택 항목 바로 등록 (${selectedOperationIndexes.length})`
                    : `선택 항목 반영 (${selectedOperationIndexes.length})`}
              </button>
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => {
                  setPendingProposal(undefined);
                  setSelectedOperationIndexes([]);
                }}
              >
                변경안 취소
              </button>
            </div>
          ) : null}
        </div>
      ) : isLoading ? (
        <p className="description-text">{responseText}</p>
      ) : hideInitialResult ? null : (
        <p className="empty-text">대기 중인 초안이나 변경안이 없습니다.</p>
      )}

      {applyResult ? <p className="success-text">{applyResult}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  ) : null;

  return (
    <section className={`panel ai-command-center ${compact ? "compact" : ""} ${directApply ? "direct" : ""} ${className}`}>
      <header className="panel-header ai-command-header">
        <div>
          <p className="eyebrow">AI COMMAND</p>
          <h2>{title}</h2>
          <small>{subtitle}</small>
        </div>
        <p className={`endpoint-status ${endpointStatus}`} title={endpointStatusMessage}>
          {endpointStatus === "ok" ? "연결 정상" : endpointStatus === "checking" ? "연결 확인" : "연결 오류"}
        </p>
      </header>

      {showEndpointInfo ? (
        <div className="ai-endpoint-block">
          <p className="description-text">Endpoint: {setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL}</p>
          <p className="description-text">
            모델: {setting.llmModel ?? "(미설정)"} / API Key: {setting.llmApiKey ? "설정됨" : "미설정"}
          </p>
        </div>
      ) : null}

      {showEndpointInfo && endpointStatus === "error" ? (
        <p className="error-text" role="alert">
          {endpointStatusMessage}
        </p>
      ) : null}

      {resultPresentation === "modal" ? resultCard : null}

      <div className="ai-request-grid">
        <label className="ai-input-label">
          {inputLabel ? <span>{inputLabel}</span> : <span className="sr-only">AI 요청</span>}
          <textarea
            ref={textareaRef}
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onRequestClose?.();
                return;
              }
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }
              event.preventDefault();
              if (canApplyProposalWithEnter) {
                void handleApplyProposal();
                return;
              }
              if (!isLoading && draft.trim()) {
                void handleSend();
              }
            }}
            rows={compact ? 4 : 5}
            placeholder={placeholder}
          />
        </label>

        {quickPrompts.length > 0 ? (
          <div className="ai-prompt-chip-row" aria-label="요청 예시">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setDraft(prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ai-action-stack">
          <button className="btn btn-primary btn-large" type="button" disabled={isLoading || !draft.trim()} onClick={() => void handleSend()}>
            {isLoading ? "분석 중" : "초안 만들기"}
          </button>
          {showRetryButton ? (
            <button
              className="btn btn-outline"
              type="button"
              disabled={isLoading || !lastUserMessage}
              onClick={() => {
                void handleSend(lastUserMessage);
              }}
            >
              마지막 요청 다시 실행
            </button>
          ) : null}
        </div>
      </div>

      {resultPresentation !== "modal" ? resultCard : null}
    </section>
  );
}
