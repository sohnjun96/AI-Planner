export interface NoteActionValidation {
  titleError?: string;
  whenError?: string;
  startAtIso?: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Unknown times default to the next upcoming 09:00, rather than a past time. */
export function defaultNoteActionWhen(startAt?: string, now = new Date()): string {
  if (startAt) {
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(startAt) ? `${startAt}T09:00` : startAt);
    if (!Number.isNaN(parsed.getTime())) return toLocalInput(parsed);
  }
  const fallback = new Date(now);
  fallback.setHours(9, 0, 0, 0);
  if (fallback.getTime() <= now.getTime()) fallback.setDate(fallback.getDate() + 1);
  return toLocalInput(fallback);
}

export function validateNoteAction(title: string, when: string): NoteActionValidation {
  const result: NoteActionValidation = {};
  const trimmed = title.trim();
  if (!trimmed) result.titleError = "할 일 제목을 입력해 주세요.";
  else if (trimmed.length > 500) result.titleError = "일정 제목은 500자 이하여야 합니다.";

  const parts = when.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  const parsed = new Date(when);
  if (
    !parts || Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== Number(parts[1]) || parsed.getMonth() + 1 !== Number(parts[2]) ||
    parsed.getDate() !== Number(parts[3]) || parsed.getHours() !== Number(parts[4]) ||
    parsed.getMinutes() !== Number(parts[5]) || parsed.getSeconds() !== Number(parts[6] ?? 0)
  ) {
    result.whenError = "유효한 일정 날짜와 시간을 입력해 주세요.";
  } else result.startAtIso = parsed.toISOString();
  return result;
}
