import { useEffect, useState } from "react";
import type { ToastOptions } from "../utils/toast";

interface ToastItem {
  id: number;
  message: string;
  tone: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
}

let toastSeq = 0;

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timerIds = new Set<number>();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string } & ToastOptions>).detail;
      if (!detail?.message) return;

      const message = detail.message;
      const id = ++toastSeq;
      const tone = detail.tone ?? "success";
      setToasts((previous) => [
        ...previous.slice(-2),
        { id, message, tone, actionLabel: detail.actionLabel, onAction: detail.onAction },
      ]);

      const timerId = window.setTimeout(() => {
        timerIds.delete(timerId);
        setToasts((previous) => previous.filter((toast) => toast.id !== id));
      }, detail.duration ?? (tone === "error" ? 6_000 : 3_500));
      timerIds.add(timerId);
    };

    window.addEventListener("ai-planner:toast", handler);
    return () => {
      window.removeEventListener("ai-planner:toast", handler);
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
      timerIds.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

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
                setToasts((previous) => previous.filter((item) => item.id !== toast.id));
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="toast-close"
            aria-label="알림 닫기"
            onClick={() => setToasts((previous) => previous.filter((item) => item.id !== toast.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
