import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildLlmChatRequestBody,
  generationOptionsFromSetting,
  type LlmGenerationOptions,
} from "../agent/llmClient";
import { runScheduleAgent } from "../agent/scheduleAgent";
import type {
  AgentConversationMessage,
  AgentContextSuggestion,
  AgentCreateTaskOperation,
  AgentDeleteTaskOperation,
  AgentOperation,
  AgentProposal,
  AgentUpdateTaskOperation,
  ScheduleAgentProgress,
} from "../agent/scheduleAgent";
import { isAbortError } from "../agent/agentUtils";
import { DEFAULT_LLM_CHAT_COMPLETIONS_URL, STATUS_LABELS } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";

interface AiAssistantWorkspaceProps {
  compact?: boolean;
  showHeader?: boolean;
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
  onDraftPreserved?: (draft: string) => void;
  onOpenAiSettings?: () => void;
  isActive?: boolean;
}

type EndpointStatus = "checking" | "ok" | "error";

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "NOT_DONE" || value === "ON_HOLD" || value === "DONE" || value === "CANCELED";
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

async function probeEndpoint(
  endpoint: string,
  apiKey: string,
  model: string,
  generationOptions: LlmGenerationOptions,
): Promise<void> {
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
        ...buildLlmChatRequestBody({
          model,
          messages: [{ role: "user", content: "ping" }],
          stream: false,
          generationOptions,
        }),
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

function formatProposalDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
  return `${date.getMonth() + 1}/${date.getDate()}(${weekday}) ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatProposalTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function ProposalDateTime({ startAt, endAt }: { startAt: string; endAt?: string }) {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    return <span className="proposal-date-time">{startAt}</span>;
  }
  if (!endAt) {
    return <span className="proposal-date-time">{formatProposalDate(start)}</span>;
  }

  const end = new Date(endAt);
  if (Number.isNaN(end.getTime())) {
    return <span className="proposal-date-time">{formatProposalDate(start)}</span>;
  }
  const isSameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  if (isSameDay) {
    return <span className="proposal-date-time same-day">{formatProposalTime(start)} ⮕ {formatProposalTime(end)}</span>;
  }

  return (
    <span className="proposal-date-time different-day">
      <span>{formatProposalDate(start)}</span>
      <span className="proposal-date-time-arrow" aria-hidden="true">⬇</span>
      <span>{formatProposalDate(end)}</span>
    </span>
  );
}

function ProposalUpdateDateTime({
  previousStartAt,
  previousEndAt,
  nextStartAt,
  nextEndAt,
}: {
  previousStartAt?: string;
  previousEndAt?: string;
  nextStartAt: string;
  nextEndAt?: string;
}) {
  // A ranged schedule is shown as the final revised range only.
  if (nextEndAt) {
    return <ProposalDateTime startAt={nextStartAt} endAt={nextEndAt} />;
  }

  // The arrow represents before/after only for point-in-time schedules.
  if (!previousStartAt || previousEndAt) {
    return <ProposalDateTime startAt={nextStartAt} />;
  }

  const previous = new Date(previousStartAt);
  const next = new Date(nextStartAt);
  if (Number.isNaN(previous.getTime()) || Number.isNaN(next.getTime()) || previous.getTime() === next.getTime()) {
    return <ProposalDateTime startAt={nextStartAt} />;
  }

  const isSameDay =
    previous.getFullYear() === next.getFullYear() &&
    previous.getMonth() === next.getMonth() &&
    previous.getDate() === next.getDate();

  if (isSameDay) {
    return (
      <span className="proposal-date-time same-day">
        {formatProposalTime(previous)} ⮕ {formatProposalTime(next)}
      </span>
    );
  }

  return (
    <span className="proposal-date-time different-day">
      <span>{formatProposalDate(previous)}</span>
      <span className="proposal-date-time-arrow" aria-hidden="true">⬇</span>
      <span>{formatProposalDate(next)}</span>
    </span>
  );
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
  showHeader = true,
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
  onDraftPreserved,
  onOpenAiSettings,
  isActive = true,
}: AiAssistantWorkspaceProps) {
  const { tasks, projects, taskTypes, setting, userContext, createTask, updateTask, removeTask, acceptUserContextSuggestion } = useAppData();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(initialDraft);
  const onDraftPreservedRef = useRef(onDraftPreserved);
  const [draft, setDraft] = useState(initialDraft);
  const [retryMessage, setRetryMessage] = useState(initialDraft.trim());
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [lastAssistantMessage, setLastAssistantMessage] = useState(
    "일정 요청을 입력하면 AI가 필요한 질문과 초안, 변경안을 정리해서 보여줍니다.",
  );
  const [lastQuestion, setLastQuestion] = useState("");
  const [pendingProposal, setPendingProposal] = useState<AgentProposal | undefined>(undefined);
  const [pendingContextSuggestions, setPendingContextSuggestions] = useState<AgentContextSuggestion[]>([]);
  const [selectedOperationIndexes, setSelectedOperationIndexes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aiProgress, setAiProgress] = useState("");
  const [lastTrace, setLastTrace] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [applyResult, setApplyResult] = useState("");
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus>("checking");
  const [endpointStatusMessage, setEndpointStatusMessage] = useState("연결 확인 중");

  const taskMap = useMemo(() => Object.fromEntries(tasks.map((task) => [task.id, task])), [tasks]);
  const generationOptions = useMemo(
    () => generationOptionsFromSetting(setting),
    [setting],
  );
  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const taskTypeMap = useMemo(() => Object.fromEntries(taskTypes.map((taskType) => [taskType.id, taskType])), [taskTypes]);
  const selectedOperationSet = useMemo(() => new Set(selectedOperationIndexes), [selectedOperationIndexes]);
  const hasOperations = (pendingProposal?.operations.length ?? 0) > 0;
  const hasVisibleResult = Boolean(
    pendingProposal || pendingContextSuggestions.length > 0 || lastQuestion || error || notice || applyResult || isLoading,
  );
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

    // Destructive operations require an explicit opt-in in the review UI.
    setSelectedOperationIndexes(
      pendingProposal.operations
        .map((operation, index) => (operation.action === "delete_task" ? -1 : index))
        .filter((index) => index >= 0),
    );
  }, [pendingProposal]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    let isMounted = true;
    setEndpointStatus("checking");
    setEndpointStatusMessage("연결 확인 중");

    void probeEndpoint(
      setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
      setting.llmApiKey ?? "",
      setting.llmModel ?? "",
      generationOptions,
    )
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
  }, [generationOptions, isActive, setting.llmApiKey, setting.llmEndpoint, setting.llmModel]);

  // 모달을 닫는 등 컴포넌트가 사라지면 진행 중인 AI 요청을 중단한다.
  useEffect(() => {
    onDraftPreservedRef.current = onDraftPreserved;
  }, [onDraftPreserved]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      onDraftPreservedRef.current?.(draftRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      abortRef.current?.abort();
      onDraftPreservedRef.current?.(draftRef.current);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      focusTextareaAtEnd(textareaRef.current);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isActive]);

  useEffect(() => {
    setDraft(initialDraft);
    draftRef.current = initialDraft;
    setRetryMessage(initialDraft.trim());
    if (!isActive) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      focusTextareaAtEnd(textareaRef.current, initialDraft);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [initialDraft, isActive]);

  useEffect(() => {
    if (!pendingProposal || !isActive) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      focusTextareaAtEnd(textareaRef.current);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isActive, pendingProposal]);

  async function handleSend(messageOverride?: string) {
    const userMessage = (messageOverride ?? draft).trim();
    if (!userMessage || isLoading) {
      return;
    }

    setError("");
    setNotice("");
    setApplyResult("");
    setLastQuestion("");
    setPendingProposal(undefined);
    setPendingContextSuggestions([]);
    setRetryMessage(userMessage);
    // 새 요청은 진행 중이던 이전 요청을 중단하고 시작한다.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setAiProgress("AI 준비 중…");
    setLastTrace("");

    try {
      const handleProgress = (info: ScheduleAgentProgress) => {
        setAiProgress(info.phase === "writing" ? `${info.label}… ${info.chars ?? 0}자` : `${info.label} 조회 중…`);
      };
      const result = await runScheduleAgent({
        userMessage,
        conversation: conversationContext,
        tasks,
        projects,
        taskTypes,
        userContext,
        userContextMaxLength: setting.aiContextMaxLength,
        endpoint: setting.llmEndpoint ?? DEFAULT_LLM_CHAT_COMPLETIONS_URL,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        generationOptions,
        onProgress: handleProgress,
        signal: controller.signal,
      });

      setLastUserMessage(userMessage);
      setLastAssistantMessage(result.assistantMessage);
      setLastQuestion(result.needsUserInput ? result.question ?? "추가 정보가 필요합니다." : "");
      setPendingProposal(result.proposal);
      setPendingContextSuggestions(result.contextSuggestions);
      setLastTrace(result.trace ?? "");
      if (draftRef.current.trim() === userMessage) {
        setDraft("");
        draftRef.current = "";
      }
      setEndpointStatus("ok");
      setEndpointStatusMessage("정상");
    } catch (runError) {
      if (isAbortError(runError)) {
        setNotice("요청을 취소했습니다. 입력 내용은 그대로 남아 있습니다.");
        return;
      }
      const message = toFriendlyError(runError);
      setError(message);
      setLastQuestion("");
      setPendingContextSuggestions([]);
      setEndpointStatus("error");
      setEndpointStatusMessage(message);
    } finally {
      // 이 요청이 여전히 최신일 때만 로딩 상태를 해제한다 (새 요청과의 경합 방지).
      if (abortRef.current === controller) {
        setIsLoading(false);
      }
    }
  }

  function handleCancelRequest() {
    if (!isLoading) {
      return;
    }
    setAiProgress("요청 취소 중…");
    abortRef.current?.abort();
  }

  function handleOpenAiSettings() {
    if (onOpenAiSettings) {
      onOpenAiSettings();
      return;
    }
    window.location.hash = "/settings?section=ai";
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
    if (operation.expectedUpdatedAt && target.updatedAt !== operation.expectedUpdatedAt) {
      throw new Error("AI가 조회한 뒤 일정이 변경되었습니다. 최신 상태로 다시 요청해 주세요.");
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
    if (operation.expectedUpdatedAt && taskMap[operation.taskId].updatedAt !== operation.expectedUpdatedAt) {
      throw new Error("AI가 조회한 뒤 일정이 변경되었습니다. 최신 상태로 다시 요청해 주세요.");
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
    setNotice("");
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

    const remainingEntries = pendingProposal.operations
      .map((operation, index) => ({ operation, originalIndex: index }))
      .filter(({ originalIndex }) => !selectedOperationSet.has(originalIndex) || failedIndexSet.has(originalIndex));
    const remainingOperations = remainingEntries.map(({ operation }) => operation);

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
      setSelectedOperationIndexes(
        remainingEntries
          .map(({ originalIndex }, index) => (failedIndexSet.has(originalIndex) ? index : -1))
          .filter((index) => index >= 0),
      );
    }

    setIsApplying(false);
    if (failedLogs.length > 0) {
      setError(`일부 변경을 반영하지 못했습니다. 실패한 ${failedLogs.length}건을 선택한 상태로 남겨두었습니다. 다시 시도해 주세요.\n${failedLogs.join("\n")}`);
      return;
    }
    onApplied?.();
  }

  async function handleAcceptContextSuggestion(suggestion: AgentContextSuggestion, index: number) {
    try {
      await acceptUserContextSuggestion(suggestion);
      setPendingContextSuggestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
      setApplyResult("AI 맞춤 규칙에 새 규칙을 저장했습니다.");
    } catch (suggestionError) {
      setError(suggestionError instanceof Error ? suggestionError.message : "컨텍스트 저장에 실패했습니다.");
    }
  }

  async function handleAcceptAllContextSuggestions() {
    try {
      for (const suggestion of pendingContextSuggestions) {
        await acceptUserContextSuggestion(suggestion);
      }
      setPendingContextSuggestions([]);
      setApplyResult("AI 맞춤 규칙에 규칙을 모두 저장했습니다.");
    } catch (suggestionError) {
      setError(suggestionError instanceof Error ? suggestionError.message : "컨텍스트 저장에 실패했습니다.");
    }
  }

  /** 규칙 내용을 구조화된 칩으로 렌더링한다 (슬래시로 이어붙인 문자열보다 훑기 쉽다) */
  function renderContextSuggestionChips(suggestion: AgentContextSuggestion) {
    const projectName = suggestion.projectId ? projectMap[suggestion.projectId]?.name ?? suggestion.projectId : "";
    const taskTypeName = suggestion.taskTypeId ? taskTypeMap[suggestion.taskTypeId]?.name ?? suggestion.taskTypeId : "";
    return (
      <div className="ctx-chip-row">
        {suggestion.trigger.map((keyword) => (
          <span key={keyword} className="ctx-chip keyword">
            {keyword}
          </span>
        ))}
        {suggestion.defaultTime ? <span className="ctx-chip time">🕐 {suggestion.defaultTime}</span> : null}
        {projectName ? <span className="ctx-chip">📁 {projectName}</span> : null}
        {taskTypeName ? <span className="ctx-chip">{taskTypeName}</span> : null}
        {suggestion.isMajor ? <span className="ctx-chip major">중요 표시</span> : null}
      </div>
    );
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
            <span className="proposal-card-body proposal-create-body">
              <span className="proposal-create-details">
                <span className="proposal-create-primary">
                  <span className={`proposal-action-pill ${actionMeta.tone}`}>{actionMeta.label}</span>
                  <span className="proposal-title-line">
                    <strong>{operation.title}</strong>
                  </span>
                  {operation.isMajor ? <span className="major-tag">중요</span> : null}
                </span>
                <span className="proposal-create-secondary">
                  <span className={`status-badge ${operation.status.toLowerCase()}`}>{STATUS_LABELS[operation.status]}</span>
                  <span className="proposal-meta-grid">
                    <span>{projectName}</span>
                    <span>{taskTypeName}</span>
                  </span>
                </span>
                {operation.content ? <small>{operation.content}</small> : null}
              </span>
              <ProposalDateTime startAt={operation.startAt} endAt={operation.endAt} />
            </span>
          </label>
        </li>
      );
    }

    if (operation.action === "update_task") {
      const target = taskMap[operation.taskId];
      const nextTitle = typeof operation.changes.title === "string" ? operation.changes.title : target?.title ?? operation.taskId;
      const nextStatus = isTaskStatus(operation.changes.status) ? operation.changes.status : target?.status ?? "NOT_DONE";
      const nextProjectId = typeof operation.changes.projectId === "string" ? operation.changes.projectId : target?.projectId;
      const nextTaskTypeId = typeof operation.changes.taskTypeId === "string" ? operation.changes.taskTypeId : target?.taskTypeId;
      const nextStartAt = typeof operation.changes.startAt === "string" ? operation.changes.startAt : target?.startAt;
      const nextEndAt = Object.hasOwn(operation.changes, "endAt") ? operation.changes.endAt ?? undefined : target?.endAt;
      const nextIsMajor = typeof operation.changes.isMajor === "boolean" ? operation.changes.isMajor : target?.isMajor ?? false;
      const nextContent = typeof operation.changes.content === "string" ? operation.changes.content : undefined;
      const projectName = nextProjectId ? projectMap[nextProjectId]?.name ?? nextProjectId : "프로젝트 없음";
      const taskTypeName = nextTaskTypeId ? taskTypeMap[nextTaskTypeId]?.name ?? nextTaskTypeId : "종류 없음";
      return (
        <li key={`proposal-${index}`} className={`proposal-card ${actionMeta.tone} ${isSelected ? "selected" : ""}`}>
          <label className="proposal-item-toggle">
            <input type="checkbox" checked={isSelected} onChange={(event) => toggleSelection(event.target.checked)} />
            <span className="proposal-checkmark" aria-hidden="true" />
            <span className="proposal-card-body proposal-create-body">
              <span className="proposal-create-details">
                <span className="proposal-create-primary">
                  <span className={`proposal-action-pill ${actionMeta.tone}`}>{actionMeta.label}</span>
                  <span className="proposal-title-line">
                    <strong>{nextTitle}</strong>
                  </span>
                  {nextIsMajor ? <span className="major-tag">중요</span> : null}
                </span>
                <span className="proposal-create-secondary">
                  <span className={`status-badge ${nextStatus.toLowerCase()}`}>{STATUS_LABELS[nextStatus]}</span>
                  <span className="proposal-meta-grid">
                    <span>{projectName}</span>
                    <span>{taskTypeName}</span>
                  </span>
                </span>
                {nextContent ? <small>{nextContent}</small> : null}
              </span>
              {nextStartAt ? (
                <ProposalUpdateDateTime
                  previousStartAt={target?.startAt}
                  previousEndAt={target?.endAt}
                  nextStartAt={nextStartAt}
                  nextEndAt={nextEndAt}
                />
              ) : null}
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
  const responseText = isLoading ? aiProgress || "요청을 읽고 일정 초안을 만드는 중입니다." : lastAssistantMessage;
  const operationCount = pendingProposal?.operations.length ?? 0;
  const resultCard = shouldShowResultCard ? (
    <div className={`ai-result-card ${hasVisibleResult ? "has-output" : ""}`} aria-live="polite">
      {lastQuestion ? (
        <div className="ai-question-block">
          <span className="badge-pill danger">질문</span>
          <p>{lastQuestion}</p>
        </div>
      ) : null}

      {!isLoading && lastTrace ? <p className="ai-trace-line">🔎 AI 참고: {lastTrace}</p> : null}

      {pendingContextSuggestions.length > 0 ? (
        /* 초안보다 먼저 배치 — 규칙을 검토·저장한 뒤 초안을 반영하는 흐름 */
        <div className="context-suggestion-block">
          <div className="context-suggestion-head">
            <div className="context-suggestion-head-copy">
              <div className="context-suggestion-title-row">
                <span className="badge-pill">AI 맞춤 규칙</span>
                <strong>💡 AI가 학습한 규칙 {pendingContextSuggestions.length}개</strong>
              </div>
              <p className="description-text">
                {pendingProposal
                  ? "규칙을 먼저 검토하세요. 저장하면 다음 요청부터 자동 적용됩니다. 일정 초안은 아래에 있어요."
                  : "반복해서 쓸 수 있는 일정 해석 규칙만 저장하세요."}
              </p>
            </div>
            <div className="button-row compact">
              {pendingContextSuggestions.length > 1 ? (
                <button className="btn btn-primary btn-compact" type="button" onClick={() => void handleAcceptAllContextSuggestions()}>
                  모두 저장
                </button>
              ) : null}
              <button className="btn btn-outline btn-compact" type="button" onClick={() => setPendingContextSuggestions([])}>
                모두 무시
              </button>
            </div>
          </div>
          <ul className="context-suggestion-list">
            {pendingContextSuggestions.map((suggestion, index) => (
              <li key={`${suggestion.category}-${suggestion.trigger.join("-")}-${index}`}>
                <div className="context-suggestion-body">
                  <strong>{suggestion.label ?? suggestion.trigger.join(", ")}</strong>
                  {renderContextSuggestionChips(suggestion)}
                  {suggestion.reason || suggestion.note ? <small>{suggestion.reason ?? suggestion.note}</small> : null}
                </div>
                <div className="context-suggestion-actions">
                  <button
                    className="btn btn-primary btn-compact"
                    type="button"
                    onClick={() => {
                      void handleAcceptContextSuggestion(suggestion, index);
                    }}
                  >
                    규칙 저장
                  </button>
                  <button
                    className="btn btn-outline btn-compact"
                    type="button"
                    onClick={() => setPendingContextSuggestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    무시
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingProposal ? (
        <div className="proposal-block compact-review">
          <div className="proposal-summary-row">
            <div>
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

      {applyResult ? (
        <p className="success-text" role="status" aria-live="polite">
          {applyResult}
        </p>
      ) : null}
      {notice ? (
        <p className="description-text" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div className="ai-error-recovery">
          <p className="error-text" role="alert" aria-live="assertive">{error}</p>
          <div className="button-row compact">
            {retryMessage ? (
              <button className="btn btn-outline btn-compact" type="button" disabled={isLoading} onClick={() => void handleSend(retryMessage)}>
                다시 시도
              </button>
            ) : null}
            <button className="btn btn-soft btn-compact" type="button" onClick={handleOpenAiSettings}>
              AI 설정 열기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <section
      className={`panel ai-command-center ${compact ? "compact" : ""} ${directApply ? "direct" : ""} ${
        hasVisibleResult ? "has-result" : ""
      } ${isLoading ? "is-loading" : ""} ${className}`}
      aria-busy={isLoading}
    >
      {showHeader ? (
        <header className="panel-header ai-command-header">
          <div>
            <p className="eyebrow">AI COMMAND</p>
            <h2>{title}</h2>
            <small>{subtitle}</small>
          </div>
          <p className={`endpoint-status ${endpointStatus}`} title={endpointStatusMessage} role="status" aria-live="polite">
            {endpointStatus === "ok" ? "연결 정상" : endpointStatus === "checking" ? "연결 확인" : "연결 오류"}
          </p>
        </header>
      ) : null}

      {!showHeader && endpointStatus === "error" && !isLoading ? (
        <div className="ai-connection-warn" role="alert">
          <span>⚠ AI 서버에 연결할 수 없어요. 설정에서 연결 상태를 확인해 주세요.</span>{" "}
          <button className="btn btn-outline btn-compact" type="button" onClick={handleOpenAiSettings}>
            AI 설정 열기
          </button>
        </div>
      ) : null}

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
            data-dialog-initial-focus
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              draftRef.current = event.target.value;
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (isLoading) {
                  handleCancelRequest();
                } else {
                  onRequestClose?.();
                }
                return;
              }
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }
              event.preventDefault();
              // 입력 내용이 있으면 항상 '전송'이 우선 — 초안이 떠 있어도 수정 요청을 보낸다.
              // 입력창이 빈 상태에서의 Enter만 선택 항목 반영으로 동작한다.
              if (draft.trim()) {
                if (!isLoading) {
                  void handleSend();
                }
                return;
              }
              if (canApplyProposalWithEnter) {
                void handleApplyProposal();
              }
            }}
            rows={compact ? 4 : 5}
            placeholder={placeholder}
          />
        </label>

        {quickPrompts.length > 0 && !pendingProposal && !isLoading ? (
          <div className="ai-prompt-chip-row" aria-label="요청 예시">
            <span className="ai-prompt-chip-hint">예시</span>
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setDraft(prompt);
                  draftRef.current = prompt;
                  focusTextareaAtEnd(textareaRef.current, prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ai-composer-footer">
          <span className="ai-composer-kbd">
            {pendingProposal
              ? "수정 요청 입력 후 Enter 전송 · 빈 칸에서 Enter는 선택 항목 반영"
              : "Enter 초안 만들기 · Shift+Enter 줄바꿈"}
          </span>
          <div className="ai-action-stack">
            {isLoading ? (
              <button className="btn btn-outline" type="button" onClick={handleCancelRequest}>
                요청 취소
              </button>
            ) : null}
            {!isLoading && (showRetryButton || Boolean(notice)) ? (
              <button
                className="btn btn-outline"
                type="button"
                disabled={!retryMessage}
                onClick={() => {
                  void handleSend(retryMessage);
                }}
              >
                다시 시도
              </button>
            ) : null}
            <button className="btn btn-primary btn-large" type="button" disabled={isLoading || !draft.trim()} onClick={() => void handleSend()}>
              {isLoading ? "분석 중…" : "초안 만들기"}
            </button>
          </div>
        </div>
      </div>

      {resultPresentation !== "modal" ? resultCard : null}
    </section>
  );
}
