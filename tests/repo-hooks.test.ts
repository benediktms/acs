import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("loads canonical startup guidance for started, resumed, and cleared sessions", () => {
  const config = JSON.parse(readFileSync(".codex/hooks.json", "utf8"));
  const startup = readFileSync("skills/acs-swarm/STARTUP.md", "utf8");

  expect(config.hooks.SessionStart).toEqual([
    {
      matcher: "^(startup|resume|clear)$",
      hooks: [
        expect.objectContaining({
          type: "command",
          command: "cat skills/acs-swarm/STARTUP.md",
        }),
      ],
    },
  ]);
  expect(startup).toContain("starts, resumes, or is cleared");
});
