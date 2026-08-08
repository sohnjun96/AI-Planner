export interface AutoBackupIntegrityEntry {
  id: string;
  createdAt: string;
  reason: string;
  raw: string;
}

export function areAutoBackupEntriesEqual(
  expected: readonly AutoBackupIntegrityEntry[],
  actual: readonly AutoBackupIntegrityEntry[],
): boolean {
  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every((entry, index) => {
    const stored = actual[index];
    return (
      stored !== undefined &&
      stored.id === entry.id &&
      stored.createdAt === entry.createdAt &&
      stored.reason === entry.reason &&
      stored.raw === entry.raw
    );
  });
}
