import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexAppServerLaunchAgent,
  codexZshIntegration,
  installCodexAppServer,
  installService,
  launchAgent,
  ownedCodexAppServerPid,
  persistentEnvironment,
  removeCodexAppServers,
  restartCodexAppServer,
  syncCodexZshIntegration,
} from "../apps/acs/src/service";

test("persistent runtime paths are absolute", () => {
  expect(
    persistentEnvironment(
      {
        ACS_HOME: ".acs",
        ACS_CONFIG_PATH: "config.toml",
        ACS_STORAGE_PATH: "data/acs.db",
        ACS_CONTROL_SOCKET: "run/control.sock",
        ACS_CODEX_BINARY: "codex",
      },
      "/work/repo",
    ),
  ).toMatchObject({
    ACS_HOME: "/work/repo/.acs",
    ACS_CONFIG_PATH: "/work/repo/config.toml",
    ACS_STORAGE_PATH: "/work/repo/data/acs.db",
    ACS_CONTROL_SOCKET: "/work/repo/run/control.sock",
    ACS_CODEX_BINARY: "codex",
  });
});

test("login service preserves executable arguments and the bridge socket environment", () => {
  const agent = launchAgent({
    command: ["/Applications/ACS & Tools/acs"],
    environment: { ACS_CONTROL_SOCKET: "/private/tmp/acs/control.sock" },
    log: "/Users/example/Library/Logs/acs.log",
  });
  expect(agent.ProgramArguments).toEqual(["/Applications/ACS & Tools/acs", "daemon", "start"]);
  expect(agent.EnvironmentVariables.ACS_CONTROL_SOCKET).toBe("/private/tmp/acs/control.sock");
  expect(agent.KeepAlive).toBe(true);
  expect(agent.RunAtLoad).toBe(true);
  if (process.platform === "darwin") {
    const encoded = Bun.spawnSync(["/usr/bin/plutil", "-convert", "xml1", "-o", "-", "-"], {
      stdin: Buffer.from(JSON.stringify(agent)),
    });
    expect(encoded.exitCode).toBe(0);
    const decoded = Bun.spawnSync(["/usr/bin/plutil", "-convert", "json", "-o", "-", "-"], {
      stdin: encoded.stdout,
    });
    expect(decoded.exitCode).toBe(0);
    expect(JSON.parse(decoded.stdout.toString())).toEqual(agent);
  }
});

test("Codex account service and zsh integration are account-scoped", () => {
  const agent = codexAppServerLaunchAgent({
    binary: "/opt/homebrew/bin/codex",
    home: "/Users/example/.codex/accounts/personal",
    socket: "/tmp/acs-501/codex-abc.sock",
    label: "personal",
    log: "/Users/example/Library/Logs/acs-codex-personal.log",
  });
  expect(agent.Label).toBe("local.acs.codex-app-server.personal");
  expect(agent.ProgramArguments).toEqual([
    "/opt/homebrew/bin/codex",
    "app-server",
    "--listen",
    "unix:///tmp/acs-501/codex-abc.sock",
  ]);
  expect(agent.EnvironmentVariables.CODEX_HOME).toContain("personal");
  expect(agent.Umask).toBe(0o77);
  expect(agent.SoftResourceLimits.NumberOfFiles).toBe(4096);
  const integration = codexZshIntegration(
    ["/Applications/acs", "/work/acs/main.ts"],
    "/Applications/Codex O'Brien/codex",
  );
  expect(integration).toContain("--acs-standalone");
  expect(integration).toContain("--remote requires --acs-standalone");
  expect(integration).toContain("--remote=*)");
  expect(integration).not.toContain('" $* "');
  expect(integration).toContain("codex socket");
  expect(integration).toContain('"${acs_bin[@]}"');
  expect(integration).toContain("-C|-c|-m|-p|-s|-a|--cd|--model");
  expect(integration).toContain("session_command");
  expect(integration).toContain("exec|e|review|login|logout");
  expect(integration).toContain(`local codex_bin='/Applications/Codex O'\\''Brien/codex'`);
  expect(integration).not.toContain("command codex");
});

test.skipIf(!Bun.which("zsh"))(
  "Codex zsh integration treats prompt text as a managed session",
  () => {
    const root = mkdtempSync(join(tmpdir(), "acs-zsh-")),
      bin = join(root, "bin"),
      acs = join(bin, "acs"),
      codex = join(root, "Codex Binary"),
      output = join(root, "args");
    mkdirSync(bin);
    writeFileSync(acs, "#!/bin/sh\nprintf '/tmp/acs.sock\\n'\n");
    writeFileSync(codex, '#!/bin/sh\nprintf "%s\\n" "$@" > "$ACS_TEST_OUTPUT"\n');
    chmodSync(acs, 0o755);
    chmodSync(codex, 0o755);
    try {
      const managed = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex 'fix --remote tests'`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(managed.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe(
        "--app-server-url\nunix:///tmp/acs.sock\nfix --remote tests\n",
      );
      const direct = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex exec test`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(direct.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("exec\ntest\n");
      for (const option of ["-c", "-p", "-s", "-a"]) {
        const shortOption = Bun.spawnSync(
          ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex ${option} value exec test`],
          { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
        );
        expect(shortOption.exitCode).toBe(0);
        expect(readFileSync(output, "utf8")).toBe(`${option}\nvalue\nexec\ntest\n`);
      }
      const remote = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex --remote=unix:///tmp/other`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(remote.exitCode).toBe(2);
      const standalone = Bun.spawnSync(
        [
          "zsh",
          "-fc",
          `${codexZshIntegration([acs], codex)}\ncodex --remote=unix:///tmp/other --acs-standalone`,
        ],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(standalone.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("--remote=unix:///tmp/other\n");
    } finally {
      rmSync(root, { recursive: true });
    }
  },
);

test("finds only the Codex listener owned by the configured account", () => {
  const inspect = {
    listenerPid: (socket: string) => (socket === "/tmp/account.sock" ? 42 : undefined),
    processDetails: (pid: number) => `codex app-server CODEX_HOME=/tmp/account pid=${pid}`,
  };
  expect(ownedCodexAppServerPid("/tmp/account", "/tmp/account.sock", inspect)).toBe(42);
  expect(ownedCodexAppServerPid("/tmp/account", "/tmp/other.sock", inspect)).toBeUndefined();
  expect(() => ownedCodexAppServerPid("/tmp/stale", "/tmp/account.sock", inspect)).toThrow(
    "CODEX_APP_SERVER_OWNERSHIP_UNVERIFIED",
  );
});

test("enabled Codex with no accounts removes the zsh integration", () => {
  const root = mkdtempSync(join(tmpdir(), "acs-zsh-empty-")),
    integration = join(root, ".zshrc.d", "acs-codex.zsh"),
    zshrc = join(root, ".zshrc");
  mkdirSync(join(root, ".zshrc.d"));
  writeFileSync(integration, "stale");
  writeFileSync(zshrc, `before\n\n# acs-codex-routing\nsource "${integration}"\n`);
  try {
    syncCodexZshIntegration({
      enabled: true,
      accountCount: 0,
      home: root,
      command: ["acs"],
      codexBinary: "codex",
    });
    expect(existsSync(integration)).toBe(false);
    expect(readFileSync(zshrc, "utf8")).toBe("before\n\n");
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("restarts only the selected Codex account service", () => {
  const calls: string[] = [];
  restartCodexAppServer({
    label: "work",
    uid: 501,
    launchctl: (args) => {
      calls.push(args.join(" "));
      return { success: true, error: "" };
    },
  });
  expect(calls).toEqual(["kickstart -k gui/501/local.acs.codex-app-server.work"]);
});

test.skipIf(process.platform !== "darwin")(
  "rebootstraps changed Codex account services and removes retired accounts",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "acs-codex-service-")),
      actions: string[] = [];
    let loaded = true;
    const launchctl = (args: string[]) => {
      actions.push(args.join(" "));
      if (args[0] === "print") return { success: loaded, error: "not loaded" };
      if (args[0] === "bootout") loaded = false;
      if (args[0] === "bootstrap") loaded = true;
      return { success: true, error: "" };
    };
    try {
      const agentDirectory = join(home, "Library/LaunchAgents");
      mkdirSync(agentDirectory, { recursive: true });
      writeFileSync(join(agentDirectory, "local.acs.codex-app-server.retired.plist"), "retired");
      await installCodexAppServer({
        binary: "/usr/local/bin/codex",
        home: "/tmp/codex",
        socket: "/tmp/codex.sock",
        label: "active",
        userHome: home,
        uid: 999,
        launchctl,
        socketOccupied: async () => false,
      });
      await installCodexAppServer({
        binary: "/usr/local/bin/codex",
        home: "/tmp/codex",
        socket: "/tmp/changed.sock",
        label: "active",
        userHome: home,
        uid: 999,
        launchctl,
        socketOccupied: async () => false,
      });
      removeCodexAppServers({ labels: ["active"], userHome: home, uid: 999, launchctl });
      expect(actions).toContain("bootout gui/999/local.acs.codex-app-server.active");
      expect(actions).toContain(
        `bootstrap gui/999 ${agentDirectory}/local.acs.codex-app-server.active.plist`,
      );
      expect(actions).toContain("bootout gui/999/local.acs.codex-app-server.retired");
      expect(existsSync(join(agentDirectory, "local.acs.codex-app-server.retired.plist"))).toBe(
        false,
      );
    } finally {
      rmSync(home, { recursive: true });
    }
  },
);

test.skipIf(process.platform !== "darwin")(
  "init migrates an unmanaged daemon and restarts an unchanged service",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "acs-service-")),
      success = { success: true, error: "" },
      failure = { success: false, error: "not loaded" },
      actions: string[] = [];
    let loaded = false;
    const launchctl = (command: string[]) => {
      const operation = command.join(" ");
      actions.push(operation);
      if (command[0] === "print")
        return command[1] === "gui/999/local.acs.daemon" && loaded ? success : failure;
      if (command[0] === "bootstrap") loaded = true;
      return success;
    };
    try {
      const options = {
        home,
        launchctl,
        uid: 999,
        command: ["/Applications/acs"],
        environment: { ACS_CONTROL_SOCKET: "/tmp/test-acs.sock" },
        stopUnmanagedDaemon: async () => {
          actions.push("stop unmanaged");
        },
      };
      await installService(options);
      expect(actions).toEqual([
        "print gui/999/local.acs.daemon",
        "print gui/999/local.asc.daemon",
        "stop unmanaged",
        `bootstrap gui/999 ${home}/Library/LaunchAgents/local.acs.daemon.plist`,
      ]);
      actions.length = 0;
      await installService(options);
      expect(actions).toEqual([
        "print gui/999/local.acs.daemon",
        "print gui/999/local.asc.daemon",
        "kickstart -k gui/999/local.acs.daemon",
      ]);
    } finally {
      rmSync(home, { recursive: true });
    }
  },
);

for (const legacyLoaded of [false, true]) {
  test.skipIf(process.platform !== "darwin")(
    `init retires the legacy service (loaded: ${legacyLoaded})`,
    async () => {
      const home = mkdtempSync(join(tmpdir(), "acs-service-")),
        legacyPath = join(home, "Library/LaunchAgents/local.asc.daemon.plist"),
        actions: string[] = [];
      mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
      writeFileSync(legacyPath, "legacy plist");
      try {
        await installService({
          home,
          uid: 999,
          command: ["/Applications/acs"],
          environment: {},
          stopUnmanagedDaemon: async () => {
            actions.push("stop unmanaged");
          },
          launchctl: (args) => {
            actions.push(args.join(" "));
            return {
              success:
                args[0] !== "print" || (args[1] === "gui/999/local.asc.daemon" && legacyLoaded),
              error: "not loaded",
            };
          },
        });
        expect(actions).toEqual([
          "print gui/999/local.acs.daemon",
          "print gui/999/local.asc.daemon",
          ...(legacyLoaded ? ["bootout gui/999/local.asc.daemon"] : []),
          "stop unmanaged",
          `bootstrap gui/999 ${home}/Library/LaunchAgents/local.acs.daemon.plist`,
        ]);
        expect(existsSync(legacyPath)).toBe(false);
      } finally {
        rmSync(home, { recursive: true });
      }
    },
  );
}

test.skipIf(process.platform !== "darwin")(
  "init aborts when the legacy service cannot stop",
  async () => {
    const home = mkdtempSync(join(tmpdir(), "acs-service-")),
      legacyPath = join(home, "Library/LaunchAgents/local.asc.daemon.plist"),
      actions: string[] = [];
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(legacyPath, "legacy plist");
    try {
      await expect(
        installService({
          home,
          uid: 999,
          command: ["/Applications/acs"],
          environment: {},
          stopUnmanagedDaemon: async () => {
            actions.push("stop unmanaged");
          },
          launchctl: (args) => {
            actions.push(args.join(" "));
            return {
              success: args[0] === "print" && args[1] === "gui/999/local.asc.daemon",
              error: "bootout denied",
            };
          },
        }),
      ).rejects.toThrow("bootout denied");
      expect(actions).toEqual([
        "print gui/999/local.acs.daemon",
        "print gui/999/local.asc.daemon",
        "bootout gui/999/local.asc.daemon",
      ]);
      expect(existsSync(legacyPath)).toBe(true);
      expect(existsSync(join(home, "Library/LaunchAgents/local.acs.daemon.plist"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true });
    }
  },
);
