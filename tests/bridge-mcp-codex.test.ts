import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isConfiguredCodexRuntime } from "../packages/bridge-mcp-codex/src/index";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

test("selects only the configured Codex runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "acs-runtime-")),
    home = join(root, "personal"),
    staleHome = join(root, "stale"),
    socket = join(root, "personal.sock");
  roots.push(root);
  mkdirSync(home);
  mkdirSync(staleHome);
  expect(
    isConfiguredCodexRuntime(
      {
        harnessId: "codex",
        label: "personal",
        endpoint: { home: join(home, "..", "personal"), socket },
      },
      "personal",
      home,
      socket,
    ),
  ).toBe(true);
  expect(
    isConfiguredCodexRuntime(
      { harnessId: "codex", label: "personal", endpoint: { home: staleHome, socket } },
      "personal",
      home,
      socket,
    ),
  ).toBe(false);
  expect(
    isConfiguredCodexRuntime(
      { harnessId: "other", label: "personal", endpoint: { home, socket } },
      "personal",
      home,
      socket,
    ),
  ).toBe(false);
  expect(
    isConfiguredCodexRuntime(
      {
        harnessId: "codex",
        label: "personal",
        endpoint: { home, socket: join(root, "stale.sock") },
      },
      "personal",
      home,
      socket,
    ),
  ).toBe(false);
});
