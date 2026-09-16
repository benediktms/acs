import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDaemonLogWriter, pruneDaemonLogs, writeDaemonLog } from "../apps/acs/src/daemon-log";

test("partitions daemon logs by day and retains seven days", () => {
  const directory = mkdtempSync(join(tmpdir(), "acs-daemon-log-"));
  try {
    writeFileSync(join(directory, "acs-2026-09-01.log"), "old");
    writeDaemonLog(directory, "current", new Date("2026-09-15T12:00:00.000Z"));
    pruneDaemonLogs(directory, "2026-09-15");
    expect(readFileSync(join(directory, "acs-2026-09-15.log"), "utf8")).toBe("current\n");
    expect(existsSync(join(directory, "acs-2026-09-01.log"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("caps logs at complete records with headroom between trims", () => {
  const directory = mkdtempSync(join(tmpdir(), "acs-daemon-log-"));
  try {
    const path = join(directory, "acs-2026-09-15.log"),
      line = `${"x".repeat(1023)}\n`,
      now = new Date("2026-09-15T12:00:00.000Z");
    writeFileSync(path, line.repeat(10 * 1024));
    writeDaemonLog(directory, '{"event":"first"}', now);
    const trimmedSize = statSync(path).size;
    expect(trimmedSize).toBeLessThanOrEqual(8 * 1024 * 1024);
    writeDaemonLog(directory, '{"event":"second"}', now);
    expect(statSync(path).size).toBe(trimmedSize + Buffer.byteLength('{"event":"second"}\n'));
    const records = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(records.at(-2)).toBe('{"event":"first"}');
    expect(records.at(-1)).toBe('{"event":"second"}');
    expect(records.every((record) => record.length === 1023 || JSON.parse(record))).toBe(true);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("summarizes an oversized JSON record as one parseable line", () => {
  const directory = mkdtempSync(join(tmpdir(), "acs-daemon-log-"));
  try {
    writeDaemonLog(
      directory,
      JSON.stringify({
        timestamp: "now",
        severity: "error",
        event: "failure",
        message: "x".repeat(2 * 1024 * 1024),
      }),
      new Date("2026-09-15T12:00:00.000Z"),
    );
    const path = join(directory, "acs-2026-09-15.log"),
      lines = readFileSync(path, "utf8").trimEnd().split("\n"),
      record = JSON.parse(lines[0] ?? "");
    expect(lines).toHaveLength(1);
    expect(statSync(path).size).toBeLessThanOrEqual(1024 * 1024);
    expect(record).toMatchObject({
      timestamp: "now",
      severity: "error",
      event: "failure",
      truncated: true,
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("falls back without throwing when the log directory is unavailable", () => {
  const path = join(mkdtempSync(join(tmpdir(), "acs-daemon-log-")), "not-a-directory");
  writeFileSync(path, "file");
  const fallback: string[] = [];
  createDaemonLogWriter(path, (record) => fallback.push(record))("record");
  expect(fallback).toEqual(["record"]);
  rmSync(dirname(path), { recursive: true });
});

test("persists fatal records only for daemon run", () => {
  const home = mkdtempSync(join(tmpdir(), "acs-daemon-fatal-")),
    main = join(import.meta.dir, "../apps/acs/src/main.ts"),
    config = join(home, "invalid.toml"),
    environment = { ...process.env, HOME: home, ACS_CONFIG_PATH: config };
  try {
    writeFileSync(config, "invalid = [");
    expect(Bun.spawnSync([process.execPath, main, "unknown"], { env: environment }).exitCode).toBe(
      1,
    );
    expect(existsSync(join(home, "Library/Logs/acs"))).toBe(false);
    expect(
      Bun.spawnSync([process.execPath, main, "daemon", "run"], { env: environment }).exitCode,
    ).toBe(1);
    const log = readFileSync(
      join(home, `Library/Logs/acs/acs-${new Date().toISOString().slice(0, 10)}.log`),
      "utf8",
    );
    expect(JSON.parse(log).event).toBe("daemon.fatal");
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("runs a configured foreground daemon without HOME", async () => {
  const home = mkdtempSync(join(tmpdir(), "acs-daemon-no-home-")),
    main = join(import.meta.dir, "../apps/acs/src/main.ts"),
    reservation = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    }),
    environment = {
      ...process.env,
      HOME: home,
      ACS_HOME: join(home, "state"),
      ACS_CONTROL_SOCKET: join(home, "control.sock"),
      ACS_STORAGE_PATH: join(home, "acs.db"),
      ACS_A2A_PORT: String(reservation.port),
    };
  reservation.stop(true);
  expect(
    Bun.spawnSync([process.execPath, main, "init", "--no-service"], { env: environment }).exitCode,
  ).toBe(0);
  const daemon = Bun.spawn([process.execPath, main, "daemon", "run"], {
    env: { ...environment, HOME: undefined },
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    await Bun.sleep(300);
    expect(daemon.exitCode).toBeNull();
    daemon.kill();
    expect(await new Response(daemon.stderr).text()).toContain("daemon.started");
    await daemon.exited;
  } finally {
    if (daemon.exitCode === null) daemon.kill();
    rmSync(home, { recursive: true });
  }
});
