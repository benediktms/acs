import { expect, test } from "bun:test";
import { pickSession, sessionChoices } from "../apps/acs/src/session-picker";

const sessions = [
  {
    session: { installationId: "ins_codex", opaqueId: "thread-one" },
    runtimeState: "idle",
    title: "Architect",
    cwd: "/workspace/architect",
  },
  {
    session: { installationId: "ins_codex", opaqueId: "thread-two" },
    runtimeState: "not-loaded",
    title: "Backend",
  },
];

test("interactive Codex binding selects a discovered session without copying its ID", async () => {
  let prompt = "";
  expect(
    await pickSession(sessions, async (value) => {
      prompt = value;
      return "2";
    }),
  ).toEqual({ installationId: "ins_codex", opaqueId: "thread-two" });
  expect(prompt).toContain("Architect [idle] /workspace/architect");
  expect(prompt).toContain("Backend [not-loaded]");
  expect(prompt).not.toContain("thread-two");
});

test("maps runtime session snapshots into picker choices", () => {
  expect(
    sessionChoices([
      {
        session: { installationId: "ins_codex", opaqueId: "thread-one" },
        runtimeState: "idle",
        attributes: { displayTitle: "Architect", cwdHint: "/workspace/architect" },
      },
    ]),
  ).toEqual([sessions[0]]);
});

test("interactive Codex binding rejects missing, malformed, and out-of-range choices", async () => {
  expect(pickSession([], async () => "1")).rejects.toThrow("No Codex sessions found");
  for (const answer of ["", "backend", "0", "3", "1.5"])
    expect(pickSession(sessions, async () => answer)).rejects.toThrow("Invalid session selection");
});
