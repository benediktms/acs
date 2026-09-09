import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("automatically registers started, resumed, and cleared sessions with ACS", () => {
  const config = JSON.parse(readFileSync(".codex/hooks.json", "utf8"));

  expect(config.hooks.SessionStart).toEqual([
    {
      matcher: "^(startup|resume|clear)$",
      hooks: [
        expect.objectContaining({
          type: "command",
          command: expect.stringContaining("call acs_identity"),
        }),
      ],
    },
  ]);
  expect(config.hooks.SessionStart[0].hooks[0].command).toContain("unbound state");
  expect(config.hooks.SessionStart[0].hooks[0].command).toContain("first model turn");
  expect(config.hooks.SessionStart[0].hooks[0].command).toContain(
    "before handling the user request",
  );
  expect(config.hooks.SessionStart[0].hooks[0].command).toContain("choose a short unique");
  expect(config.hooks.SessionStart[0].hooks[0].command).toContain("call acs_register");
  expect(config.hooks.SessionStart[0].hooks[0].command).toContain("choose another and retry");
  expect(config.hooks.SessionStart[0].hooks[0].command).toContain("Do not ask the user");
});
