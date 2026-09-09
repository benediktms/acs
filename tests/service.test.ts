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
import { dirname, join } from "node:path";
import {
  codexAppServerLaunchAgent,
  type DaemonServiceStatus,
  codexZshIntegration,
  daemonServiceStatus,
  installCodexAppServer,
  installService,
  launchAgent,
  listenerPidCommand,
  ownedCodexAppServerPid,
  persistentEnvironment,
  removeCodexAppServers,
  restartCodexAppServer,
  restartDaemonService,
  startDaemonService,
  stopDaemonService,
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
  expect(agent.ProgramArguments).toEqual(["/Applications/ACS & Tools/acs", "daemon", "run"]);
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

test("manages only the ACS LaunchAgent lifecycle", async () => {
  const home = mkdtempSync(join(tmpdir(), "acs-daemon-service-")),
    path = join(home, "Library/LaunchAgents/local.acs.daemon.plist"),
    calls: string[] = [],
    events: string[] = [];
  let loaded = false;
  const launchctl = (args: string[]) => {
    calls.push(args.join(" "));
    events.push(args.join(" "));
    if (args[0] === "print") return { success: loaded, error: "not loaded" };
    if (args[0] === "bootstrap") loaded = true;
    if (args[0] === "bootout") loaded = false;
    return { success: true, error: "" };
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "plist");
  try {
    let ready = 0,
      stopped = 0,
      unmanaged = 0;
    const options = {
      home,
      uid: 999,
      launchctl,
      waitUntilReady: async () => {
        ready++;
        events.push("ready wait");
      },
      waitUntilStopped: async () => {
        stopped++;
        events.push("stopped wait");
      },
      stopUnmanagedDaemon: async () => {
        unmanaged++;
        events.push("unmanaged stop");
      },
    };
    await startDaemonService(options);
    await startDaemonService(options);
    expect(calls).toEqual([
      "print gui/999/local.acs.daemon",
      `bootstrap gui/999 ${path}`,
      "print gui/999/local.acs.daemon",
    ]);
    expect(ready).toBe(2);
    calls.length = 0;
    await stopDaemonService(options);
    expect(calls).toEqual([
      "print gui/999/local.acs.daemon",
      "bootout gui/999/local.acs.daemon",
      "print gui/999/local.acs.daemon",
    ]);
    expect(stopped).toBe(1);
    expect(unmanaged).toBe(0);
    calls.length = 0;
    await stopDaemonService(options);
    expect(calls).toEqual(["print gui/999/local.acs.daemon"]);
    expect(stopped).toBe(2);
    expect(unmanaged).toBe(1);
    calls.length = 0;
    events.length = 0;
    loaded = true;
    await restartDaemonService(options);
    expect(calls).toEqual([
      "print gui/999/local.acs.daemon",
      "bootout gui/999/local.acs.daemon",
      "print gui/999/local.acs.daemon",
      "print gui/999/local.acs.daemon",
      `bootstrap gui/999 ${path}`,
    ]);
    expect(events).toEqual([
      "print gui/999/local.acs.daemon",
      "bootout gui/999/local.acs.daemon",
      "print gui/999/local.acs.daemon",
      "stopped wait",
      "print gui/999/local.acs.daemon",
      `bootstrap gui/999 ${path}`,
      "ready wait",
    ]);
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("does not bootstrap over an occupied unmanaged socket", async () => {
  const home = mkdtempSync(join(tmpdir(), "acs-daemon-service-")),
    path = join(home, "Library/LaunchAgents/local.acs.daemon.plist"),
    calls: string[] = [];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "plist");
  try {
    await expect(
      startDaemonService({
        home,
        uid: 999,
        launchctl: (args) => {
          calls.push(args.join(" "));
          return { success: false, error: "not loaded" };
        },
        isSocketOccupied: async () => true,
        waitUntilReady: async () => {},
      }),
    ).rejects.toThrow("stop the unmanaged daemon");
    expect(calls).toEqual(["print gui/999/local.acs.daemon"]);
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("waits for launchd to report an unloaded service before restarting", async () => {
  const home = mkdtempSync(join(tmpdir(), "acs-daemon-service-")),
    path = join(home, "Library/LaunchAgents/local.acs.daemon.plist"),
    events: string[] = [];
  let loaded = true,
    unloading = false,
    unloadPolls = 0;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "plist");
  try {
    await restartDaemonService({
      home,
      uid: 999,
      launchctl: (args) => {
        events.push(args.join(" "));
        if (args[0] === "bootout") {
          unloading = true;
          return { success: true, error: "" };
        }
        if (args[0] === "print" && unloading && unloadPolls++ === 1) {
          loaded = false;
          unloading = false;
        }
        if (args[0] === "bootstrap") loaded = true;
        return { success: loaded, error: "not loaded" };
      },
      sleep: async () => {
        events.push("sleep");
      },
      stopUnmanagedDaemon: async () => {},
      waitUntilStopped: async () => {
        events.push("stopped wait");
      },
      waitUntilReady: async () => {
        events.push("ready wait");
      },
    });
    expect(events).toEqual([
      "print gui/999/local.acs.daemon",
      "bootout gui/999/local.acs.daemon",
      "print gui/999/local.acs.daemon",
      "sleep",
      "print gui/999/local.acs.daemon",
      "stopped wait",
      "print gui/999/local.acs.daemon",
      `bootstrap gui/999 ${path}`,
      "ready wait",
    ]);
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("propagates daemon readiness and bootout failures", async () => {
  const home = mkdtempSync(join(tmpdir(), "acs-daemon-service-")),
    path = join(home, "Library/LaunchAgents/local.acs.daemon.plist");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "plist");
  try {
    await expect(
      startDaemonService({
        home,
        uid: 999,
        launchctl: (args) => ({ success: args[0] === "bootstrap", error: "not loaded" }),
        waitUntilReady: async () => {
          throw new Error("not ready");
        },
      }),
    ).rejects.toThrow("not ready");
    await expect(
      stopDaemonService({
        home,
        uid: 999,
        launchctl: (args) => ({ success: args[0] === "print", error: "bootout denied" }),
        stopUnmanagedDaemon: async () => {},
        waitUntilStopped: async () => {},
      }),
    ).rejects.toThrow("bootout denied");
  } finally {
    rmSync(home, { recursive: true });
  }
});

test("reports daemon service status without lifecycle commands", async () => {
  const cases: { loaded: boolean; protocolReady: boolean; expected: DaemonServiceStatus }[] = [
    { loaded: false, protocolReady: true, expected: { state: "control-ready", exitCode: 0 } },
    { loaded: false, protocolReady: false, expected: { state: "stopped", exitCode: 1 } },
    {
      loaded: true,
      protocolReady: false,
      expected: { state: "supervisor-running/control-unavailable", exitCode: 2 },
    },
  ];
  for (const { loaded, protocolReady, expected } of cases) {
    const calls: string[] = [];
    expect(
      await daemonServiceStatus({
        home: "/Users/example",
        uid: 501,
        launchctl: (args) => {
          calls.push(args.join(" "));
          return { success: loaded, error: "not loaded" };
        },
        isControlReady: async () => protocolReady,
      }),
    ).toEqual(expected);
    expect(calls).toEqual(["print gui/501/local.acs.daemon"]);
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
  expect(integration).toContain("-C|--cd) has_cwd=true");
  expect(integration).toContain("routed_argv");
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
        `--remote\nunix:///tmp/acs.sock\n--cd\n${process.cwd()}\nfix --remote tests\n`,
      );
      const explicitCwd = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex --cd /explicit task`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(explicitCwd.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe(
        "--remote\nunix:///tmp/acs.sock\n--cd\n/explicit\ntask\n",
      );
      const direct = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex exec test`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(direct.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("exec\ntest\n");
      const directStandalone = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex --acs-standalone exec task`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(directStandalone.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("exec\ntask\n");
      const directRemote = Bun.spawnSync(
        [
          "zsh",
          "-fc",
          `${codexZshIntegration([acs], codex)}\ncodex --remote=unix:///tmp/other exec task`,
        ],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(directRemote.exitCode).toBe(2);
      const standaloneTerminator = Bun.spawnSync(
        [
          "zsh",
          "-fc",
          `${codexZshIntegration([acs], codex)}\ncodex --acs-standalone -- '--remote'`,
        ],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(standaloneTerminator.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("--\n--remote\n");
      const resumeStandalone = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex resume --acs-standalone`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(resumeStandalone.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("resume\n");
      const resumeRemote = Bun.spawnSync(
        [
          "zsh",
          "-fc",
          `${codexZshIntegration([acs], codex)}\ncodex resume --remote=unix:///tmp/other`,
        ],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(resumeRemote.exitCode).toBe(2);
      const optionValue = Bun.spawnSync(
        ["zsh", "-fc", `${codexZshIntegration([acs], codex)}\ncodex -c --acs-standalone resume`],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACS_TEST_OUTPUT: output } },
      );
      expect(optionValue.exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe(
        `--remote\nunix:///tmp/acs.sock\n--cd\n${process.cwd()}\n-c\n--acs-standalone\nresume\n`,
      );
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
    processDetails: (pid: number) => ({
      executable: "/opt/codex",
      environment: `pid=${pid} CODEX_HOME=/tmp/account`,
    }),
  };
  expect(ownedCodexAppServerPid("/tmp/account", "/tmp/account.sock", inspect)).toBe(42);
  expect(ownedCodexAppServerPid("/tmp/account", "/tmp/other.sock", inspect)).toBeUndefined();
  expect(() => ownedCodexAppServerPid("/tmp/stale", "/tmp/account.sock", inspect)).toThrow(
    "CODEX_APP_SERVER_OWNERSHIP_UNVERIFIED",
  );
  for (const details of [
    { executable: "/opt/not-codex", environment: "CODEX_HOME=/tmp/account" },
    { executable: "/opt/codex", environment: "NOT_CODEX_HOME=/tmp/account" },
    { executable: "/opt/codex", environment: "CODEX_HOME=/tmp/account-old" },
    { executable: "/opt/codex", environment: "CODEX_HOME=/tmp/account with suffix B=2" },
  ])
    expect(() =>
      ownedCodexAppServerPid("/tmp/account", "/tmp/account.sock", {
        ...inspect,
        processDetails: () => details,
      }),
    ).toThrow("CODEX_APP_SERVER_OWNERSHIP_UNVERIFIED");
  expect(
    ownedCodexAppServerPid("/tmp/account with spaces", "/tmp/account.sock", {
      ...inspect,
      processDetails: () => ({
        executable: "/opt/codex",
        environment: "A=1 CODEX_HOME=/tmp/account with spaces B=2",
      }),
    }),
  ).toBe(42);
});

test("intersects lsof's Unix-socket and path selectors", () => {
  expect(listenerPidCommand("/tmp/account.sock")).toEqual([
    "/usr/sbin/lsof",
    "-nP",
    "-t",
    "-a",
    "-U",
    "/tmp/account.sock",
  ]);
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
