export type TaskViewMode = "LIST" | "WEEK" | "MONTH";

export const TASK_VIEW_MODES: Array<{ value: TaskViewMode; label: string }> = [
  { value: "LIST", label: "목록" },
  { value: "WEEK", label: "주간" },
  { value: "MONTH", label: "월간" },
];

export function isTaskViewMode(value: string | null | undefined): value is TaskViewMode {
  return value === "LIST" || value === "WEEK" || value === "MONTH";
}
