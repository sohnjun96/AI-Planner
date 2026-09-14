import type { TaskFormInput } from "../models";

export function trimTaskInput(input: TaskFormInput): TaskFormInput {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title || title.length > 500) throw new Error("일정 제목은 1~500자로 입력해 주세요.");
  if (content.length > 100_000) throw new Error("일정 내용은 100,000자 이하여야 합니다.");
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.taskTypeId) || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.projectId)) {
    throw new Error("일정 분류 식별자가 올바르지 않습니다.");
  }
  if (!["NOT_DONE", "ON_HOLD", "DONE", "CANCELED"].includes(input.status)) {
    throw new Error("일정 상태가 올바르지 않습니다.");
  }
  if (input.recurrencePattern && !["NONE", "DAILY", "WEEKLY", "MONTHLY"].includes(input.recurrencePattern)) {
    throw new Error("반복 주기가 올바르지 않습니다.");
  }
  const startTime = new Date(input.startAt).getTime();
  const endTime = input.endAt ? new Date(input.endAt).getTime() : undefined;
  if (!Number.isFinite(startTime) || input.startAt.length > 40 || (endTime !== undefined && (!Number.isFinite(endTime) || endTime < startTime))) {
    throw new Error("일정 시작·종료 시간이 올바르지 않습니다.");
  }
  return {
    ...input,
    title,
    content,
  };
}
