import { useEffect, useMemo, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useJsonBackupStatus } from "../hooks/useJsonBackupStatus";
import { formatDateTime } from "../utils/date";
import { showToast } from "../utils/toast";
import {
  downloadJsonBackup,
  getJsonBackupReminderDueAt,
  hasUserCreatedJsonBackupData,
  initializeJsonBackupReminder,
  isJsonBackupReminderDue,
  snoozeJsonBackupReminder,
} from "../utils/jsonBackup";

export function WeeklyBackupReminder({ compact = false }: { compact?: boolean }) {
  const {
    exportData,
    isReady: isAppDataReady,
    memos,
    notes,
    projects,
    projectSubcategories,
    setting,
    tasks,
    taskTypes,
  } = useAppData();
  const { isReady: isBackupStatusReady, status } = useJsonBackupStatus();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [isExporting, setIsExporting] = useState(false);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [error, setError] = useState("");
  const hasUserCreatedData = useMemo(
    () => hasUserCreatedJsonBackupData({ tasks, projects, taskTypes, memos, notes, projectSubcategories }),
    [memos, notes, projects, projectSubcategories, tasks, taskTypes],
  );

  useEffect(() => {
    if (
      !isAppDataReady
      || !isBackupStatusReady
      || !hasUserCreatedData
      || getJsonBackupReminderDueAt(status) !== undefined
    ) {
      return;
    }

    void initializeJsonBackupReminder().catch(() => undefined);
  }, [hasUserCreatedData, isAppDataReady, isBackupStatusReady, status]);

  useEffect(() => {
    if (!isBackupStatusReady) {
      return;
    }

    const refreshCurrentTime = () => setCurrentTime(Date.now());
    const dueAt = getJsonBackupReminderDueAt(status);
    const delay = dueAt === undefined ? undefined : Math.max(0, dueAt - Date.now() + 100);
    const timerId = delay !== undefined ? window.setTimeout(refreshCurrentTime, delay) : undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshCurrentTime();
      }
    };

    window.addEventListener("focus", refreshCurrentTime);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
      window.removeEventListener("focus", refreshCurrentTime);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isBackupStatusReady, status]);

  if (
    !isAppDataReady
    || !isBackupStatusReady
    || !hasUserCreatedData
    || !isJsonBackupReminderDue(status, currentTime)
  ) {
    return null;
  }

  const isBusy = isExporting || isSnoozing;
  const lastExportLabel = status.lastExportedAt
    ? formatDateTime(status.lastExportedAt, setting.timeFormat)
    : "아직 내보낸 백업이 없어요";

  async function handleExport() {
    if (isBusy) {
      return;
    }
    setError("");
    setIsExporting(true);
    try {
      const content = await exportData();
      await downloadJsonBackup(content);
      showToast("백업 파일 다운로드를 시작했습니다. 5MB 초과 시 ZIP으로 저장합니다.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "JSON 백업을 내보내지 못했습니다.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSnooze() {
    if (isBusy) {
      return;
    }
    setError("");
    setIsSnoozing(true);
    try {
      await snoozeJsonBackupReminder();
    } catch (snoozeError) {
      setError(snoozeError instanceof Error ? snoozeError.message : "다음 알림 시간을 저장하지 못했습니다.");
    } finally {
      setIsSnoozing(false);
    }
  }

  return (
    <aside
      className={`weekly-backup-reminder ${compact ? "compact" : ""}`}
      role="region"
      aria-live="polite"
      aria-labelledby="weekly-backup-reminder-title"
    >
      {!compact ? <div className="weekly-backup-reminder-icon" aria-hidden="true">↓</div> : null}
      <div className="weekly-backup-reminder-body">
        {!compact ? <p className="eyebrow">WEEKLY BACKUP</p> : null}
        <h2 id="weekly-backup-reminder-title">{compact ? "백업이 필요합니다" : "JSON 백업할 시간이 됐어요"}</h2>
        {!compact ? (
          <>
            <p>컴퓨터에 백업 파일을 저장해 두면 브라우저 데이터에 문제가 생겨도 다시 복원할 수 있어요.</p>
            <p className="weekly-backup-reminder-last">
              <span>마지막 JSON 내보내기</span>
              <strong>{lastExportLabel}</strong>
            </p>
          </>
        ) : null}
        {error ? (
          <p className="weekly-backup-reminder-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="weekly-backup-reminder-actions">
          <button className="btn btn-primary" type="button" onClick={() => void handleExport()} disabled={isBusy}>
            {isExporting ? "내보내는 중…" : compact ? "내보내기" : "지금 JSON 내보내기"}
          </button>
          <button className="btn btn-soft" type="button" onClick={() => void handleSnooze()} disabled={isBusy}>
            {isSnoozing ? "알림 미루는 중…" : compact ? "나중에" : "7일 뒤 다시 알림"}
          </button>
        </div>
      </div>
    </aside>
  );
}
