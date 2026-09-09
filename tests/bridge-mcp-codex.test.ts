import { expect, test } from "bun:test";
import { isConfiguredCodexRuntime } from "../packages/bridge-mcp-codex/src/index";

test("selects only the configured Codex runtime", () => {
  const home = "/tmp/acs-personal",
    socket = "/tmp/personal.sock";
  expect(
    isConfiguredCodexRuntime(
      {
        harnessId: "codex",
        label: "personal",
        endpoint: { home: "/tmp/./acs-personal", socket },
      },
      "personal",
      home,
      socket,
    ),
  ).toBe(true);
  expect(
    isConfiguredCodexRuntime(
      { harnessId: "codex", label: "personal", endpoint: { home: "/tmp/acs-stale", socket } },
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
      { harnessId: "codex", label: "personal", endpoint: { home, socket: "/tmp/stale.sock" } },
      "personal",
      home,
      socket,
    ),
  ).toBe(false);
});
