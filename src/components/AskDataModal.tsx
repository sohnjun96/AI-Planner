import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { runQaAgent, type QaReference } from "../agent/qaAgent";
import { useAppData } from "../context/AppDataContext";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface AskDataModalProps {
  onClose: () => void;
}

const EXAMPLES = [
  "이번 주에 제출 마감이 있는 일정 알려줘",
  "표준특허 관련해서 정리해둔 내용이 뭐가 있지?",
  "아직 안 끝난 중요한 일 뭐가 있어?",
];

export function AskDataModal({ onClose }: AskDataModalProps) {
  const { notes, tasks, projects, taskTypes, setting } = useAppData();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [answer, setAnswer] = useState("");
  const [references, setReferences] = useState<QaReference[]>([]);
  const [trace, setTrace] = useState("");
  const [error, setError] = useState("");

  const hasApiConfig = Boolean((setting.llmEndpoint ?? "").trim());

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleAsk() {
    const q = question.trim();
    if (!q || isRunning) {
      return;
    }
    setIsRunning(true);
    setProgress("AI 준비 중…");
    setError("");
    setAnswer("");
    setReferences([]);
    setTrace("");
    try {
      const result = await runQaAgent({
        question: q,
        notes,
        tasks,
        projects,
        taskTypes,
        endpoint: setting.llmEndpoint,
        apiKey: setting.llmApiKey ?? "",
        model: setting.llmModel,
        onProgress: (info) =>
          setProgress(info.phase === "writing" ? `AI가 작성 중… ${info.chars ?? 0}자` : `${info.label} 조회 중…`),
      });
      setAnswer(result.answer);
      setReferences(result.references);
      setTrace(result.trace ?? "");
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : "질문 처리에 실패했습니다.");
    } finally {
      setIsRunning(false);
    }
  }

  function openReference(reference: QaReference) {
    onClose();
    if (reference.type === "note") {
      navigate("/notes");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ai-planner:focus-note", { detail: { noteId: reference.id } }));
      }, 80);
    } else {
      navigate("/dashboard");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ai-planner:focus-task", { detail: { taskId: reference.id } }));
      }, 80);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal-card ask-data-modal"
        role="dialog"
        aria-modal="true"
        aria-label="내 데이터에 질문"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-header">
          <div>
            <p className="eyebrow">ASK</p>
            <h2>내 노트·일정에 질문</h2>
            <small>노트와 일정을 검색해서 답해 드려요.</small>
          </div>
          <button type="button" className="btn btn-soft" onClick={onClose}>
            닫기
          </button>
        </header>

        {!hasApiConfig ? (
          <p className="description-text">설정에서 LLM 엔드포인트와 API 키를 먼저 입력해 주세요.</p>
        ) : null}

        <div className="ask-input-row">
          <textarea
            className="ask-textarea"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="예: 지난달 표준특허 관련해서 뭐 결정했지?"
            rows={2}
            autoFocus
            disabled={isRunning}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void handleAsk();
              }
            }}
          />
          <button type="button" className="btn btn-primary" onClick={() => void handleAsk()} disabled={isRunning || !hasApiConfig || !question.trim()}>
            {isRunning ? "찾는 중…" : "질문"}
          </button>
        </div>

        {!answer && !isRunning && !error ? (
          <div className="ask-examples">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="ask-example-chip" onClick={() => setQuestion(example)}>
                {example}
              </button>
            ))}
          </div>
        ) : null}

        <div className="ask-answer">
          {isRunning ? (
            <p className="note-ai-running">
              <span className="note-ai-spinner" aria-hidden="true" />
              {progress || "찾는 중…"}
            </p>
          ) : null}
          {answer ? <MarkdownRenderer content={answer} /> : null}
          {error ? <p className="error-text">{error}</p> : null}

          {references.length > 0 ? (
            <div className="ask-references">
              <span className="ask-references-label">참고</span>
              {references.map((reference) => (
                <button
                  key={`${reference.type}-${reference.id}`}
                  type="button"
                  className={`ask-reference-chip ${reference.type}`}
                  onClick={() => openReference(reference)}
                >
                  {reference.type === "note" ? "📝" : "📅"} {reference.title}
                </button>
              ))}
            </div>
          ) : null}

          {!isRunning && trace ? <p className="ai-trace-line">🔎 {trace}</p> : null}
        </div>
      </section>
    </div>
  );
}
