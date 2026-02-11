import { useMemo, useState } from "react";
import { LLM_CHAT_COMPLETIONS_URL } from "../constants";
import { useAppData } from "../context/AppDataContext";
import type { Task, TaskFormInput, TaskStatus } from "../models";
import {
  runScheduleAgent,
  type AgentConversationMessage,
  type AgentCreateTaskOperation,
  type AgentDeleteTaskOperation,
  type AgentOperation,
  type AgentProposal,
  type AgentUpdateTaskOperation,
} from "../agent/scheduleAgent";
import { formatDateTime } from "../utils/date";

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

export function AiAssistantPage() {
  const { tasks, projects, taskTypes, setting, createTask, updateTask, removeTask } = useAppData();
  const [conversation, setConversation] = useState<AgentConversationMessage[]>([
    {
      role: "assistant",
      content:
        "일정 관련 요청을 자연어로 입력해 주세요. 저는 필요한 조회를 수행한 뒤, 반영 전 최종 확인용 변경안을 먼저 보여드립니다.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [pendingProposal, setPendingProposal] = useState<AgentProposal | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");
  const [applyResult, setApplyResult] = useState("");

  const taskMap = useMemo(() => Object.fromEntries(tasks.map((task) => [task.id, task])), [tasks]);
  const projectMap = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project])), [projects]);
  const taskTypeMap = useMemo(() => Object.fromEntries(taskTypes.map((taskType) => [taskType.id, taskType])), [taskTypes]);

  async function handleSend() {
    const userMessage = draft.trim();
    if (!userMessage || isLoading) {
      return;
    }

    const history = conversation.slice(-10);

    setError("");
    setApplyResult("");
    setDraft("");
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
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "AI 처리 중 오류가 발생했습니다.";
      setError(message);
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `요청 처리에 실패했습니다: ${message}`,
        },
      ]);
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

    setError("");
    setIsApplying(true);

    const successLogs: string[] = [];
    const failedLogs: string[] = [];

    for (const operation of pendingProposal.operations) {
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
    setPendingProposal(undefined);
    setIsApplying(false);
  }

  return (
    <div className="ai-layout">
      <section className="panel ai-chat-panel">
        <header className="panel-header">
          <h2>AI 일정 도우미</h2>
          <small>대화형 일정 추가/수정/삭제</small>
        </header>

        <p className="description-text">고정 Endpoint: {LLM_CHAT_COMPLETIONS_URL}</p>
        <p className="description-text">
          사용 모델: {setting.llmModel ?? "(미설정)"} / API Key: {setting.llmApiKey ? "설정됨" : "미설정"}
        </p>

        <div className="ai-chat-log">
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
            <ul className="proposal-list">
              {pendingProposal.operations.map((operation, index) => {
                if (operation.action === "create_task") {
                  const projectName = projectMap[operation.projectId]?.name ?? operation.projectId;
                  const taskTypeName = taskTypeMap[operation.taskTypeId]?.name ?? operation.taskTypeId;

                  return (
                    <li key={`proposal-${index}`}>
                      <strong>[추가]</strong> {operation.title}
                      <br />
                      <small>
                        {formatDateTime(operation.startAt, setting.timeFormat)}
                        {operation.endAt ? ` ~ ${formatDateTime(operation.endAt, setting.timeFormat)}` : ""}
                        {` / 프로젝트: ${projectName} / 종류: ${taskTypeName}`}
                      </small>
                    </li>
                  );
                }

                if (operation.action === "update_task") {
                  const taskTitle = taskMap[operation.taskId]?.title ?? operation.taskId;
                  return (
                    <li key={`proposal-${index}`}>
                      <strong>[수정]</strong> {taskTitle}
                      <br />
                      <small>변경 필드: {Object.keys(operation.changes).join(", ")}</small>
                    </li>
                  );
                }

                const taskTitle = taskMap[operation.taskId]?.title ?? operation.taskId;
                return (
                  <li key={`proposal-${index}`}>
                    <strong>[삭제]</strong> {taskTitle}
                  </li>
                );
              })}
            </ul>

            <div className="button-row">
              <button
                className="btn btn-primary"
                type="button"
                disabled={isApplying}
                onClick={() => void handleApplyProposal()}
              >
                {isApplying ? "반영 중..." : "변경안 반영"}
              </button>
              <button
                className="btn btn-soft"
                type="button"
                onClick={() => {
                  setPendingProposal(undefined);
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
