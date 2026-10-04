import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useLocation, useNavigate } from "../routing";
import { addDays, formatDateTime } from "../utils/date";
import { toTaskInput } from "../utils/taskInput";
import {
  acknowledgeReminders, emptyReminderState, enqueueReminders, normalizeReminderIds,
  parseReminderState, removeReminder, SCHEDULE_REMINDER_STORAGE_KEY, type ScheduleReminderState,
} from "../utils/reminderQueue";
import { clearReminderSnoozes, scheduleReminderSnooze } from "../utils/reminderSnooze";
import { showToast } from "../utils/toast";
import type { Task, TaskStatus } from "../models";
import { STATUS_LABELS } from "../constants";

function readStoredQueue() {
  try { return parseReminderState(window.localStorage.getItem(SCHEDULE_REMINDER_STORAGE_KEY)); }
  catch { return emptyReminderState(); }
}

export function useScheduleReminders(onAiEdit: (draft: string) => void) {
  const { tasks, updateTask, isReady, setting } = useAppData();
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState(readStoredQueue);
  const stateRef = useRef(state);
  const handledLinkRef = useRef("");
  const persistenceErrorRef = useRef(false);
  const resetRevisionRef = useRef(0);
  const commit = useCallback((update: (current: ScheduleReminderState) => ScheduleReminderState) => {
    const next = update(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    try {
      window.localStorage.setItem(SCHEDULE_REMINDER_STORAGE_KEY, JSON.stringify(next));
    } catch {
      if (!persistenceErrorRef.current) {
        persistenceErrorRef.current = true;
        showToast("알림 목록을 저장하지 못했습니다. 이 창에서 확인해 주세요.", { tone: "error" });
      }
    }
    window.dispatchEvent(new Event("ai-planner:schedule-reminders-changed"));
  }, []);

  const removeFromUrl = useCallback((ids: string[]) => {
    const [path, query = ""] = window.location.hash.slice(1).split("?");
    let params = new URLSearchParams(query);
    if (params.get("review") !== "1") return;
    const previous = params.toString();
    for (const id of ids) params = removeReminder(params, id);
    if (params.toString() !== previous) navigate(`${path || "/dashboard"}${params.size ? `?${params}` : ""}`, { replace: true });
  }, [navigate]);

  useEffect(() => {
    const receiveStoredQueue = (event: StorageEvent) => {
      if (event.key !== SCHEDULE_REMINDER_STORAGE_KEY && event.key !== null) return;
      const next = readStoredQueue();
      stateRef.current = next;
      setState(next);
    };
    const reset = () => {
      resetRevisionRef.current += 1;
      const oldIds = [...stateRef.current.ids];
      commit(() => emptyReminderState());
      removeFromUrl(oldIds);
    };
    window.addEventListener("storage", receiveStoredQueue);
    window.addEventListener("ai-planner:data-restored", reset);
    return () => {
      window.removeEventListener("storage", receiveStoredQueue);
      window.removeEventListener("ai-planner:data-restored", reset);
    };
  }, [commit, removeFromUrl]);

  useEffect(() => {
    if (!isReady) return;
    const timer = window.setTimeout(() => {
      const link = `${location.pathname}${location.search}`;
      const params = new URLSearchParams(location.search);
      if (params.get("review") === "1" && handledLinkRef.current !== link) {
        handledLinkRef.current = link;
        const incoming = normalizeReminderIds(params.getAll("taskId"));
        const validIds = incoming.filter((id) => tasks.some((task) => task.id === id && task.status !== "DONE" && task.status !== "CANCELED"));
        commit((current) => enqueueReminders(current, validIds));
        removeFromUrl(incoming);
      }
      const invalid = stateRef.current.ids.filter((id) => !tasks.some((task) => task.id === id && task.status !== "DONE" && task.status !== "CANCELED"));
      if (invalid.length) {
        commit((current) => acknowledgeReminders(current, invalid));
        void clearReminderSnoozes(invalid).catch(() => showToast("지난 다시 알림 예약을 정리하지 못했습니다.", { tone: "error" }));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tasks, isReady, location.pathname, location.search, state.ids, commit, removeFromUrl]);

  useEffect(() => {
    const times = Object.values(state.snoozed);
    if (!times.length) return;
    const delay = Math.max(0, Math.min(...times) - Date.now());
    const timer = window.setTimeout(() => {
      const now = Date.now();
      commit((current) => {
        const snoozed = Object.fromEntries(Object.entries(current.snoozed).filter(([, when]) => when > now));
        return Object.keys(snoozed).length === Object.keys(current.snoozed).length ? current : { ...current, snoozed, closed: false };
      });
    }, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [state.snoozed, commit]);

  const pendingTasks = useMemo(() => state.ids.filter((id) => !Object.hasOwn(state.snoozed, id))
    .map((id) => tasks.find((task) => task.id === id))
    .filter((task): task is Task => task !== undefined && task.status !== "DONE" && task.status !== "CANCELED"), [state.ids, state.snoozed, tasks]);
  const selectedTask = pendingTasks.find((task) => task.id === state.selectedId) ?? pendingTasks[0];
  const close = useCallback(() => commit((current) => ({ ...current, closed: true })), [commit]);
  const open = useCallback(() => {
    if (!pendingTasks.length) { showToast("확인할 일정 알림이 없습니다."); return; }
    commit((current) => ({ ...current, closed: false }));
  }, [pendingTasks.length, commit]);
  const select = useCallback((id: string) => commit((current) => ({ ...current, selectedId: id })), [commit]);
  const acknowledge = useCallback((ids: string[]) => {
    commit((current) => acknowledgeReminders(current, ids));
    removeFromUrl(ids);
    void clearReminderSnoozes(ids).catch(() => showToast("다시 알림 예약을 정리하지 못했습니다.", { tone: "error" }));
  }, [commit, removeFromUrl]);

  async function changeStatus(status: TaskStatus) {
    if (!selectedTask) return;
    await updateTask(selectedTask.id, { ...toTaskInput(selectedTask), status });
    acknowledge([selectedTask.id]);
  }
  async function postpone(days: 1 | 3 | 7) {
    if (!selectedTask) return;
    const nextStartAt = addDays(new Date(selectedTask.startAt), days).toISOString();
    const offset = new Date(nextStartAt).getTime() - new Date(selectedTask.startAt).getTime();
    const nextEndAt = selectedTask.endAt ? new Date(new Date(selectedTask.endAt).getTime() + offset).toISOString() : undefined;
    const period = (start: string, end?: string) => `${formatDateTime(start, "24h")}${end ? ` ~ ${formatDateTime(end, "24h")}` : ""}`;
    const memo = `[일정 연기] ${period(selectedTask.startAt, selectedTask.endAt)} → ${period(nextStartAt, nextEndAt)}`;
    await updateTask(selectedTask.id, { ...toTaskInput(selectedTask), startAt: nextStartAt, endAt: nextEndAt,
      content: `${selectedTask.content}${selectedTask.content ? "\n\n" : ""}${memo}` });
    acknowledge([selectedTask.id]);
  }
  async function snooze() {
    if (!selectedTask) return;
    const revision = resetRevisionRef.current;
    const when = Date.now() + 30 * 60_000;
    await scheduleReminderSnooze(selectedTask.id, when);
    if (revision !== resetRevisionRef.current || !stateRef.current.ids.includes(selectedTask.id)) {
      await clearReminderSnoozes([selectedTask.id]);
      return;
    }
    commit((current) => ({ ...current, snoozed: { ...current.snoozed, [selectedTask.id]: when } }));
    removeFromUrl([selectedTask.id]);
    showToast("30분 후 다시 알려드릴게요. 일정 시간은 유지됩니다.");
  }
  function editWithAi() {
    if (!selectedTask) return;
    close();
    const period = `${formatDateTime(selectedTask.startAt, setting.timeFormat)}${selectedTask.endAt ? ` ~ ${formatDateTime(selectedTask.endAt, setting.timeFormat)}` : ""}`;
    onAiEdit(`다음 기존 일정을 수정해줘.\n- 날짜와 시간: ${period}\n- 제목: ${selectedTask.title}\n- 상태: ${STATUS_LABELS[selectedTask.status]}\n\n수정 요청: `);
  }
  return { pendingTasks, selectedTask, isOpen: !state.closed && Boolean(selectedTask), open, close, select,
    changeStatus, postpone, snooze, editWithAi,
    acknowledgeSelected: () => selectedTask && acknowledge([selectedTask.id]),
    acknowledgeAll: () => acknowledge(pendingTasks.map((task) => task.id)) };
}
