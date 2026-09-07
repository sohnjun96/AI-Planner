import JSZip from "jszip";

export const MAX_BACKUP_BYTES = 50_000_000;
export const ZIP_BACKUP_THRESHOLD = 5_000_000;

export async function encodeBackupFile(raw: string): Promise<{ blob: Blob; extension: string }> {
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength > MAX_BACKUP_BYTES) throw new Error("백업은 압축 전 50MB까지 지원합니다.");
  if (bytes.byteLength <= ZIP_BACKUP_THRESHOLD) {
    return { blob: new Blob([raw], { type: "application/json" }), extension: "json" };
  }
  const zip = new JSZip();
  zip.file("backup.json", bytes);
  const compressed = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { blob: new Blob([new Uint8Array(compressed)], { type: "application/zip" }), extension: "zip" };
}

export async function decodeBackupFile(file: Blob): Promise<string> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("백업 파일은 50MB 이하여야 합니다.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length !== 1 || files[0].name !== "backup.json") {
    throw new Error("플래나이 백업 ZIP(backup.json 한 개 포함)을 선택해 주세요.");
  }
  // 압축 해제 중에도 상한을 검사해 작은 압축 파일의 과도한 메모리 사용을 방지한다.
  return new Promise((resolve, reject) => {
    // JSZip 3.10.1의 런타임 스트림 API는 패키지 타입 선언에서 누락되어 있다.
    const entry = files[0] as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    };
    const stream = entry.internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let size = 0;
    stream.on("data", (chunk: Uint8Array) => {
      size += chunk.byteLength;
      if (size > MAX_BACKUP_BYTES) {
        stream.pause();
        chunks.length = 0;
        reject(new Error("압축 해제한 백업은 50MB 이하여야 합니다."));
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      try {
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        resolve(new TextDecoder("utf-8", { fatal: true }).decode(result));
      } catch (error) { reject(error); }
    });
    stream.resume();
  });
}
