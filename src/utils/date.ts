import type { Task } from "../models";

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function formatDateTime(value: string, timeFormat: "24h" | "12h"): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(new Date(value));
}

export function getDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function getMonthGridStart(date: Date, weekStartsOn: "sun" | "mon"): Date {
  const first = startOfMonth(date);
  const currentDay = first.getDay();
  const startIndex = weekStartsOn === "mon" ? 1 : 0;
  const diff = (currentDay - startIndex + 7) % 7;
  return addDays(first, -diff);
}

export function isPastCompletedHidden(task: Task, showPastCompleted: boolean): boolean {
  if (showPastCompleted) {
    return false;
  }

  if (task.status !== "DONE") {
    return false;
  }

  return new Date(task.startAt).getTime() < Date.now();
}

export function toLocalDateInputValue(value: string): string {
  return getDateKey(value);
}

export function toLocalTimeInputValue(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function combineDateTimeToIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const composed = new Date(year, month - 1, day, hour, minute, 0);
  return composed.toISOString();
}

export function compareByStartAtAsc(a: Task, b: Task): number {
  return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
}
