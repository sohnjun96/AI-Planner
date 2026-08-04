export interface ToastOptions {
  tone?: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

export function showToast(message: string, options: ToastOptions = {}): void {
  window.dispatchEvent(new CustomEvent("ai-planner:toast", { detail: { message, ...options } }));
}
