import { useEffect, useMemo, useState } from "react";
import { runScheduleAgent } from "../agent/scheduleAgent";
import type {
  AgentConversationMessage,
  AgentCreateTaskOperation,
  AgentDeleteTaskOperation,
  AgentOperation,
  AgentProposal,
  AgentUpdateTaskOperation,
} from "../agent/scheduleAgent";
import { LLM_CHAT_COMPLETIONS_URL } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";
import { formatDateTime } from "../utils/date";

interface AiAssistantWorkspaceProps {
  compact?: boolean;
  showEndpointInfo?: boolean;
}

type EndpointStatus = "checking" | "ok" | "error";

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

function formatOperationLabel(operation: AgentOperation): string {
  if (operation.action === "create_task") {
    return `일정 추가: ${operation.title}`;
  }
  if (operation.action === "update_task") {
    return `일정 수정: ${operation.taskId}`;
  }
  return `일정 삭제: ${operation.taskId}`;
}

function toFriendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "AI 처리 중 오류가 발생했습니다.";
  const lower = raw.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econnrefused")) {
    return `${raw}\nLLM 서버 연결 상태를 확인한 뒤 다시 시도해 주세요.`;
  }

  return raw;
}

async function probeEndpoint(apiKey: string, model: string): Promise<void> {
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
    const response = await fetch(LLM_CHAT_COMPLETIONS_URL, {
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

export function AiAssistantWorkspace({ compact = false, showEndpointInfo = true }: AiAssistantWorkspaceProps) {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask } = useAppData();
  const [conversation, setConversation] = useState<AgentConversationMessage[]>([
    {
      role: "assistant",
      content:
        "일정 관련 요청을 자연어로 입력해 주세요. 필요한 조회를 수행한 뒤 반영 전에 최종 확인용 변경안을 먼저 보여드립니다.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [lastUserMessage, setLastUserMessage] = useState("");
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

    void probeEndpoint(setting.llmApiKey ?? "", setting.llmModel ?? "")
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
  }, [setting.llmApiKey, setting.llmModel]);

  async function handleSend(messageOverride?: string) {
    const userMessage = (messageOverride ?? draft).trim();
    if (!userMessage || isLoading) {
      return;
    }

    const history = conversation.slice(-10);

    setError("");
    setApplyResult("");
    if (!messageOverride) {
      setDraft("");
    }
    setLastUserMessage(userMessage);
    setConversation((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const result = await runScheduleAgent({
        userMessage,
        conversation: history,
        tasks,
        projects,
        taskTypes,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
      });

      const assistantText =
        result.needsUserInput && result.question
          ? `${result.assistantMessage}\n\n질문: ${result.question}`
          : result.assistantMessage;

      setConversation((prev) => [...prev, { role: "assistant", content: assistantText }]);
      setPendingProposal(result.proposal);
      setEndpointStatus("ok");
      setEndpointStatusMessage("정상");
    } catch (runError) {
      const message = toFriendlyError(runError);
      setError(message);
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `요청 처리에 실패했습니다: ${message}`,
        },
      ]);
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
      throw new Error("시작 시간이 올바른 ISO 날짜 형식이 아닙니다.");
    }
    if (operation.endAt && !isValidIsoDate(operation.endAt)) {
      throw new Error("종료 시간이 올바른 ISO 날짜 형식이 아닙니다.");
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
        throw new Error("시작 시간이 올바른 ISO 날짜 형식이 아닙니다.");
      }
      nextInput.startAt = changes.startAt;
    }
    if (Object.hasOwn(changes, "endAt")) {
      if (changes.endAt !== null && typeof changes.endAt !== "string") {
        throw new Error("종료 시간 형식이 올바르지 않습니다.");
      }
      if (typeof changes.endAt === "string" && !isValidIsoDate(changes.endAt)) {
        throw new Error("종료 시간이 올바른 ISO 날짜 형식이 아닙니다.");
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

      try {
        if (operation.action === "create_task") {
          await applyCreateOperation(operation);
        } else if (operation.action === "update_task") {
          await applyUpdateOperation(operation);
        } else {
          await applyDeleteOperation(operation);
        }
        successLogs.push(formatOperationLabel(operation));
      } catch (applyError) {
        const message = applyError instanceof Error ? applyError.message : "반영 실패";
        failedLogs.push(`${formatOperationLabel(operation)} (${message})`);
        failedIndexSet.add(index);
      }
    }

    const resultTextParts = [
      successLogs.length > 0 ? `성공 ${successLogs.length}건` : "",
      failedLogs.length > 0 ? `실패 ${failedLogs.length}건` : "",
    ].filter(Boolean);

    const resultText = resultTextParts.length > 0 ? resultTextParts.join(", ") : "반영 결과가 없습니다.";
    setApplyResult(resultText);

    const assistantLog = [
      `변경안 반영 결과: ${resultText}`,
      successLogs.length > 0 ? `성공 목록: ${successLogs.join(", ")}` : "",
      failedLogs.length > 0 ? `실패 목록: ${failedLogs.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    setConversation((prev) => [...prev, { role: "assistant", content: assistantLog }]);

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
  }

  return (
    <div className={`ai-layout ${compact ? "compact" : ""}`}>
      <section className="panel ai-chat-panel">
        <header className="panel-header">
          <h2>AI 일정 도우미</h2>
          <small>대화형 일정 추가/수정/삭제</small>
        </header>

        <p className={`endpoint-status ${endpointStatus}`}>
          연결 상태: {endpointStatus === "ok" ? "정상" : endpointStatus === "checking" ? "확인 중" : "오류"}
        </p>

        {showEndpointInfo ? (
          <>
            <p className="description-text">고정 Endpoint: {LLM_CHAT_COMPLETIONS_URL}</p>
            <p className="description-text">
              사용 모델: {setting.llmModel ?? "(미설정)"} / API Key: {setting.llmApiKey ? "설정됨" : "미설정"}
            </p>
          </>
        ) : null}

        {endpointStatus === "error" ? (
          <p className="error-text" role="alert">
            {endpointStatusMessage}
          </p>
        ) : null}

        <div className="ai-chat-log" aria-live="polite">
          {conversation.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`ai-chat-item ${message.role}`}>
              <header>
                <strong>{message.role === "user" ? "나" : "AI"}</strong>
              </header>
              <p>{message.content}</p>
            </article>
          ))}
        </div>

        <div className="ai-composer">
          <label>
            요청 입력
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={4}
              placeholder="예: 내일 오전 10시에 보고서 제출 일정 추가해줘. 프로젝트는 마케팅, 종류는 제출."
            />
          </label>
          <div className="button-row">
            <button className="btn btn-primary" type="button" disabled={isLoading} onClick={() => void handleSend()}>
              {isLoading ? "분석 중..." : "AI에게 요청"}
            </button>
            <button
              className="btn btn-soft"
              type="button"
              disabled={isLoading || !lastUserMessage}
              onClick={() => {
                void handleSend(lastUserMessage);
              }}
            >
              마지막 요청 재시도
            </button>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
      </section>

      <section className="panel ai-proposal-panel">
        <header className="panel-header">
          <h2>최종 확인</h2>
        </header>

        {!pendingProposal ? <p className="empty-text">아직 반영 대기 중인 변경안이 없습니다.</p> : null}

        {pendingProposal ? (
          <div className="proposal-block">
            <p className="description-text">{pendingProposal.summary}</p>
            <div className="button-row">
              <button
                className="btn btn-soft"
                type="button"
                onClick={() => {
                  setSelectedOperationIndexes(pendingProposal.operations.map((_, index) => index));
                }}
              >
                전체 선택
              </button>
              <button
                className="btn btn-soft"
                type="button"
                onClick={() => {
                  setSelectedOperationIndexes([]);
                }}
              >
                선택 해제
              </button>
            </div>

            <ul className="proposal-list">
              {pendingProposal.operations.map((operation, index) => {
                const isSelected = selectedOperationSet.has(index);

                if (operation.action === "create_task") {
                  const projectName = projectMap[operation.projectId]?.name ?? operation.projectId;
                  const taskTypeName = taskTypeMap[operation.taskTypeId]?.name ?? operation.taskTypeId;

                  return (
                    <li key={`proposal-${index}`}>
                      <label className="proposal-item-toggle">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => {
                            setSelectedOperationIndexes((prev) => {
                              if (event.target.checked) {
                                return [...prev, index].sort((a, b) => a - b);
                              }
                              return prev.filter((item) => item !== index);
                            });
                          }}
                        />
                        <span>
                          <strong>[추가]</strong> {operation.title}
                          <br />
                          <small>
                            {formatDateTime(operation.startAt, setting.timeFormat)}
                            {operation.endAt ? ` ~ ${formatDateTime(operation.endAt, setting.timeFormat)}` : ""}
                            {` / 프로젝트: ${projectName} / 종류: ${taskTypeName}`}
                          </small>
                        </span>
                      </label>
                    </li>
                  );
                }

                if (operation.action === "update_task") {
                  const taskTitle = taskMap[operation.taskId]?.title ?? operation.taskId;
                  return (
                    <li key={`proposal-${index}`}>
                      <label className="proposal-item-toggle">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => {
                            setSelectedOperationIndexes((prev) => {
                              if (event.target.checked) {
                                return [...prev, index].sort((a, b) => a - b);
                              }
                              return prev.filter((item) => item !== index);
                            });
                          }}
                        />
                        <span>
                          <strong>[수정]</strong> {taskTitle}
                          <br />
                          <small>변경 필드: {Object.keys(operation.changes).join(", ")}</small>
                        </span>
                      </label>
                    </li>
                  );
                }

                const taskTitle = taskMap[operation.taskId]?.title ?? operation.taskId;
                return (
                  <li key={`proposal-${index}`}>
                    <label className="proposal-item-toggle">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => {
                          setSelectedOperationIndexes((prev) => {
                            if (event.target.checked) {
                              return [...prev, index].sort((a, b) => a - b);
                            }
                            return prev.filter((item) => item !== index);
                          });
                        }}
                      />
                      <span>
                        <strong>[삭제]</strong> {taskTitle}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="button-row">
              <button
                className="btn btn-primary"
                type="button"
                disabled={isApplying || selectedOperationIndexes.length === 0}
                onClick={() => void handleApplyProposal()}
              >
                {isApplying ? "반영 중..." : `선택 항목 반영 (${selectedOperationIndexes.length})`}
              </button>
              <button
                className="btn btn-soft"
                type="button"
                onClick={() => {
                  setPendingProposal(undefined);
                  setSelectedOperationIndexes([]);
                }}
              >
                변경안 취소
              </button>
            </div>
          </div>
        ) : null}

        {applyResult ? <p className="success-text">{applyResult}</p> : null}
      </section>
    </div>
  );
}
