import { expect, test } from "bun:test";
import { isConfiguredCodexRuntime } from "../packages/bridge-mcp-codex/src/index";

test("selects only the configured Codex runtime", () => {
  expect(isConfiguredCodexRuntime({ harnessId: "codex", label: "personal" }, "personal")).toBe(
    true,
  );
  expect(isConfiguredCodexRuntime({ harnessId: "other", label: "personal" }, "personal")).toBe(
    false,
  );
});
