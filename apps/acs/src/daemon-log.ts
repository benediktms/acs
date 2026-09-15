import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const maximumLogBytes = 10 * 1024 * 1024,
  retainedLogBytes = 8 * 1024 * 1024,
  maximumRecordBytes = 1024 * 1024,
  retainedDays = 7,
  filename = /^acs-(\d{4}-\d{2}-\d{2})\.log$/;

export function daemonLogDirectory(home: string) {
  return join(home, "Library", "Logs", "acs");
}

export function daemonLaunchdLogPath(home: string) {
  return join(daemonLogDirectory(home), "launchd.log");
}

export function createDaemonLogWriter(directory: string, fallback = console.error) {
  let preparedDay: string | undefined;
  return (record: string, now = new Date()) => {
    try {
      const day = now.toISOString().slice(0, 10);
      if (day !== preparedDay) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        chmodSync(directory, 0o700);
        pruneDaemonLogs(directory, day);
        preparedDay = day;
      }
      appendBoundedLog(join(directory, `acs-${day}.log`), record);
    } catch {
      fallback(record);
    }
  };
}

export function writeDaemonLog(directory: string, record: string, now = new Date()) {
  createDaemonLogWriter(directory)(record, now);
}

function appendBoundedLog(path: string, record: string) {
  const bytes = boundedRecord(record),
    size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  if (size + bytes.length <= maximumLogBytes) appendFileSync(path, bytes, { mode: 0o600 });
  else {
    const current = readFileSync(path),
      desired = Math.max(0, retainedLogBytes - bytes.length),
      start = Math.max(0, current.length - desired),
      boundary = start ? current.indexOf(0x0a, start) + 1 : 0,
      retained = boundary > 0 ? current.subarray(boundary) : Buffer.alloc(0);
    writeFileSync(path, Buffer.concat([retained, bytes]), { mode: 0o600 });
  }
  chmodSync(path, 0o600);
}

function boundedRecord(record: string) {
  const bytes = Buffer.from(`${record}\n`);
  if (bytes.length <= maximumRecordBytes) return bytes;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(record);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed))
        if (["timestamp", "severity", "daemonInstanceId", "event"].includes(key))
          metadata[key] = value;
    }
  } catch {
    metadata = {};
  }
  return Buffer.from(
    `${JSON.stringify({
      ...metadata,
      truncated: true,
      originalBytes: bytes.length - 1,
      preview: bytes.subarray(0, 64 * 1024).toString("utf8"),
    })}\n`,
  );
}

export function pruneDaemonLogs(directory: string, day: string) {
  const cutoff = new Date(`${day}T00:00:00.000Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (retainedDays - 1));
  for (const entry of readdirSync(directory)) {
    const match = entry.match(filename);
    if (match?.[1] && match[1] < cutoff.toISOString().slice(0, 10))
      unlinkSync(join(directory, entry));
  }
}
