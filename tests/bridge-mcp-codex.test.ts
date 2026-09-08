import { expect, test } from "bun:test";
import { isConfiguredCodexRuntime } from "../packages/bridge-mcp-codex/src/index";

test("selects only the configured Codex runtime", () => {
  const home = "/tmp/acs-personal";
  expect(
    isConfiguredCodexRuntime(
      { harnessId: "codex", label: "personal", endpoint: { home: "/tmp/./acs-personal" } },
      "personal",
      home,
    ),
  ).toBe(true);
  expect(
    isConfiguredCodexRuntime(
      { harnessId: "codex", label: "personal", endpoint: { home: "/tmp/acs-stale" } },
      "personal",
      home,
    ),
  ).toBe(false);
  expect(
    isConfiguredCodexRuntime(
      { harnessId: "other", label: "personal", endpoint: { home } },
      "personal",
      home,
    ),
  ).toBe(false);
});
