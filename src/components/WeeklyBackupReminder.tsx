import { useEffect, useState } from "react";
import { useAppData } from "../context/AppDataContext";
import { useJsonBackupStatus } from "../hooks/useJsonBackupStatus";
import { formatDateTime } from "../utils/date";
import { showToast } from "../utils/toast";
import {
  downloadJsonBackup,
  getJsonBackupReminderDueAt,
  isJsonBackupReminderDue,
  snoozeJsonBackupReminder,
} from "../utils/jsonBackup";

export function WeeklyBackupReminder() {
  const { exportData, setting } = useAppData();
  const { isReady, status } = useJsonBackupStatus();
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [isExporting, setIsExporting] = useState(false);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isReady) {
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
  }, [isReady, status]);

  if (!isReady || !isJsonBackupReminderDue(status, currentTime)) {
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
      showToast("JSON 백업 파일 다운로드를 시작했습니다.");
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
      className="weekly-backup-reminder"
      role="region"
      aria-live="polite"
      aria-labelledby="weekly-backup-reminder-title"
    >
      <div className="weekly-backup-reminder-icon" aria-hidden="true">
        ↓
      </div>
      <div className="weekly-backup-reminder-body">
        <p className="eyebrow">WEEKLY BACKUP</p>
        <h2 id="weekly-backup-reminder-title">JSON 백업할 시간이 됐어요</h2>
        <p>컴퓨터에 백업 파일을 저장해 두면 브라우저 데이터에 문제가 생겨도 다시 복원할 수 있어요.</p>
        <p className="weekly-backup-reminder-last">
          <span>마지막 JSON 내보내기</span>
          <strong>{lastExportLabel}</strong>
        </p>
        {error ? (
          <p className="weekly-backup-reminder-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="weekly-backup-reminder-actions">
          <button className="btn btn-primary" type="button" onClick={() => void handleExport()} disabled={isBusy}>
            {isExporting ? "내보내는 중…" : "지금 JSON 내보내기"}
          </button>
          <button className="btn btn-soft" type="button" onClick={() => void handleSnooze()} disabled={isBusy}>
            {isSnoozing ? "알림 미루는 중…" : "7일 뒤 다시 알림"}
          </button>
        </div>
      </div>
    </aside>
  );
}
