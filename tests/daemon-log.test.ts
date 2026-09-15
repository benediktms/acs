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

test("caps a daily daemon log at 10 MiB without discarding prior records", () => {
  const directory = mkdtempSync(join(tmpdir(), "acs-daemon-log-"));
  try {
    writeDaemonLog(directory, "x".repeat(11 * 1024 * 1024), new Date("2026-09-15T12:00:00.000Z"));
    writeDaemonLog(directory, "tail", new Date("2026-09-15T12:00:00.000Z"));
    expect(statSync(join(directory, "acs-2026-09-15.log")).size).toBe(10 * 1024 * 1024);
    expect(readFileSync(join(directory, "acs-2026-09-15.log"), "utf8")).toEndWith("tail\n");
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
