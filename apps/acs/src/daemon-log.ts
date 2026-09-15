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
  retainedDays = 7,
  filename = /^acs-(\d{4}-\d{2}-\d{2})\.log$/;

export function daemonLogDirectory(home: string) {
  return join(home, "Library", "Logs", "acs");
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
      appendBoundedLog(join(directory, `acs-${day}.log`), `${record}\n`);
    } catch {
      fallback(record);
    }
  };
}

export function writeDaemonLog(directory: string, record: string, now = new Date()) {
  createDaemonLogWriter(directory)(record, now);
}

function appendBoundedLog(path: string, record: string) {
  const bytes = Buffer.from(record),
    size = statSync(path, { throwIfNoEntry: false })?.size ?? 0;
  if (size + bytes.length <= maximumLogBytes) appendFileSync(path, bytes, { mode: 0o600 });
  else {
    const retained =
      bytes.length >= maximumLogBytes || !size
        ? Buffer.alloc(0)
        : readFileSync(path).subarray(-(maximumLogBytes - bytes.length));
    writeFileSync(path, Buffer.concat([retained, bytes.subarray(-maximumLogBytes)]), {
      mode: 0o600,
    });
  }
  chmodSync(path, 0o600);
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
