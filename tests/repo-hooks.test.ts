import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("loads canonical startup guidance for started, resumed, and cleared sessions", () => {
  const config = JSON.parse(readFileSync(".codex/hooks.json", "utf8"));
  const startup = readFileSync("skills/acs-swarm/STARTUP.md", "utf8");

  expect(config.hooks.SessionStart).toEqual([
    {
      matcher: "^(startup|resume|clear)$",
      hooks: [
        expect.objectContaining({
          type: "command",
          command:
            'if [ "${ACS_MANAGED_SESSION_START:-}" != 1 ]; then cat "$(git rev-parse --show-toplevel)/skills/acs-swarm/STARTUP.md"; fi',
        }),
      ],
    },
  ]);
  expect(startup).toContain("starts, resumes, or is cleared");
  const command = config.hooks.SessionStart[0].hooks[0].command;
  expect(
    Bun.spawnSync(["sh", "-c", command], {
      cwd: join(process.cwd(), "apps", "acs"),
    }).stdout.toString(),
  ).toBe(startup);
  expect(
    Bun.spawnSync(["sh", "-c", command], {
      cwd: join(process.cwd(), "apps", "acs"),
      env: { ...process.env, ACS_MANAGED_SESSION_START: "1" },
    }).stdout.toString(),
  ).toBe("");
});
