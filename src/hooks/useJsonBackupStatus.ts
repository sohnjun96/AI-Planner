import { useEffect, useState } from "react";
import {
  JSON_BACKUP_STATUS_CHANGED_EVENT,
  readJsonBackupReminderStatus,
  type JsonBackupReminderStatus,
} from "../utils/jsonBackup";

interface JsonBackupStatusSnapshot {
  isReady: boolean;
  status: JsonBackupReminderStatus;
}

export function useJsonBackupStatus(): JsonBackupStatusSnapshot {
  const [snapshot, setSnapshot] = useState<JsonBackupStatusSnapshot>({ isReady: false, status: {} });

  useEffect(() => {
    let isActive = true;

    const refreshStatus = () => {
      void readJsonBackupReminderStatus()
        .then((status) => {
          if (isActive) {
            setSnapshot({ isReady: true, status });
          }
        })
        .catch(() => {
          if (isActive) {
            setSnapshot({ isReady: true, status: {} });
          }
        });
    };

    refreshStatus();

    const handleStatusChange = (event: Event) => {
      const status = (event as CustomEvent<JsonBackupReminderStatus>).detail;
      if (status) {
        setSnapshot({ isReady: true, status });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshStatus();
      }
    };

    window.addEventListener(JSON_BACKUP_STATUS_CHANGED_EVENT, handleStatusChange);
    window.addEventListener("focus", refreshStatus);
    window.addEventListener("storage", refreshStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      isActive = false;
      window.removeEventListener(JSON_BACKUP_STATUS_CHANGED_EVENT, handleStatusChange);
      window.removeEventListener("focus", refreshStatus);
      window.removeEventListener("storage", refreshStatus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return snapshot;
}
