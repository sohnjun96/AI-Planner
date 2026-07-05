import { useEffect, useState } from "react";

export interface ToastOptions {
  tone?: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
}

let toastSeq = 0;

/** 앱 어디서든 하단 토스트를 띄운다. AppShell의 ToastHost가 수신한다. */
export function showToast(message: string, options: ToastOptions = {}): void {
  window.dispatchEvent(new CustomEvent("ai-planner:toast", { detail: { message, ...options } }));
}

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string } & ToastOptions>).detail;
      if (!detail?.message) {
        return;
      }
      const message = detail.message;
      const id = ++toastSeq;
      const tone = detail.tone ?? "success";
      // 최대 3개까지만 쌓는다 (오래된 것부터 밀어냄)
      setToasts((prev) => [
        ...prev.slice(-2),
        { id, message, tone, actionLabel: detail.actionLabel, onAction: detail.onAction },
      ]);
      const duration = detail.duration ?? (tone === "error" ? 6000 : 3500);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, duration);
    };
    window.addEventListener("ai-planner:toast", handler);
    return () => window.removeEventListener("ai-planner:toast", handler);
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <span className="toast-message">{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                setToasts((prev) => prev.filter((item) => item.id !== toast.id));
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            aria-label="알림 닫기"
            onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
