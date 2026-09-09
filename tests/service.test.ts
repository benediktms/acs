import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  codexAppServerLaunchAgent,
  daemonCommandRunsForeground,
  daemonCommandWaitsForHandover,
  daemonControlPathsFromEnvironment,
  type DaemonServiceStatus,
  daemonServiceStatus,
  installCodexAppServer,
  installService,
  installedDaemonControlPaths,
  launchAgent,
  listenerPidCommand,
  ownedCodexAppServerPid,
  persistentEnvironment,
  removeCodexAppServers,
  removeLegacySwarmLauncher,
  restartCodexAppServer,
  restartDaemonService,
  startDaemonService,
  stopDaemonService,
  stopUnmanagedDaemon,
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

test("derives installed daemon control paths from persisted environment", () => {
  expect(
    daemonControlPathsFromEnvironment({
      ACS_CONTROL_SOCKET: "/private/tmp/acs/control.sock",
      ACS_HOME: "/Users/example/.acs",
    }),
  ).toEqual({
    runtime: "/private/tmp/acs/control.sock",
    token: "/Users/example/.acs/control.token",
  });
  expect(
    daemonControlPathsFromEnvironment({
      ACS_CONTROL_SOCKET: "/private/tmp/acs/control.sock",
      HOME: "/Users/example",
    }),
  ).toEqual({
    runtime: "/private/tmp/acs/control.sock",
    token: "/Users/example/Library/Application Support/acs/control.token",
  });
  expect(() =>
    daemonControlPathsFromEnvironment({ ACS_CONTROL_SOCKET: "relative", HOME: "/Users/example" }),
  ).toThrow("ACS_CONTROL_SOCKET");
  const fallback = { runtime: "/tmp/current.sock", token: "/tmp/current.token" };
  expect(installedDaemonControlPaths("/missing", fallback)).toBe(fallback);
});

test("runs daemon start in the foreground only for its launchd service", () => {
  const launchd = { XPC_SERVICE_NAME: "local.acs.daemon" };
  expect(daemonCommandRunsForeground("run", {}, "linux")).toBe(true);
  expect(daemonCommandRunsForeground("run", launchd, "darwin")).toBe(true);
  expect(daemonCommandRunsForeground("start", launchd, "darwin")).toBe(true);
  expect(daemonCommandRunsForeground("start", launchd, "linux")).toBe(false);
  expect(daemonCommandRunsForeground("start", {}, "darwin")).toBe(false);
  expect(
    daemonCommandRunsForeground("start", { XPC_SERVICE_NAME: "other.service" }, "darwin"),
  ).toBe(false);
  expect(daemonCommandWaitsForHandover(launchd)).toBe(true);
  expect(daemonCommandWaitsForHandover({})).toBe(false);
});

test("accepts a shutdown error only after the unmanaged socket vanishes", async () => {
  const error = new Error("unauthorized");
  let probes = [true, false];
  await stopUnmanagedDaemon(
    async () => probes.shift() ?? false,
    async () => {
      throw error;
    },
  );
  probes = [true, true];
  await expect(
    stopUnmanagedDaemon(
      async () => probes.shift() ?? false,
      async () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
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
      isControlReady: async () => false,
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

test("uses authenticated shutdown only when control remains ready after launchd unload", async () => {
  for (const ready of [true, false]) {
    const events: string[] = [];
    let loaded = true;
    await stopDaemonService({
      home: "/Users/example",
      uid: 501,
      launchctl: (args) => {
        events.push(args.join(" "));
        if (args[0] === "print") return { success: loaded, error: "not loaded" };
        loaded = false;
        return { success: true, error: "" };
      },
      isControlReady: async () => {
        events.push("control ready");
        return ready;
      },
      stopUnmanagedDaemon: async () => {
        events.push("authenticated shutdown");
      },
      waitUntilStopped: async () => {
        events.push("stopped wait");
      },
    });
    expect(events).toEqual([
      "print gui/501/local.acs.daemon",
      "bootout gui/501/local.acs.daemon",
      "print gui/501/local.acs.daemon",
      "control ready",
      ...(ready ? ["authenticated shutdown"] : []),
      "stopped wait",
    ]);
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
      isControlReady: async () => false,
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
        isControlReady: async () => false,
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

test("Codex account service is account-scoped", () => {
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
});

test("initialization removes only the legacy ACS launcher and integration", () => {
  const root = mkdtempSync(join(tmpdir(), "acs-swarm-cleanup-")),
    swarm = join(root, ".local/bin/swarm"),
    integration = join(root, ".zshrc.d", "acs-codex.zsh"),
    zshrc = join(root, ".zshrc");
  mkdirSync(dirname(swarm), { recursive: true });
  mkdirSync(dirname(integration), { recursive: true });
  writeFileSync(swarm, "#!/bin/sh\n# acs-swarm-launcher\nlegacy\n");
  writeFileSync(integration, "legacy");
  writeFileSync(zshrc, `before\n\n# acs-codex-routing\nsource "${integration}"\n`);
  try {
    removeLegacySwarmLauncher(root);
    expect(existsSync(swarm)).toBe(false);
    expect(existsSync(integration)).toBe(false);
    expect(readFileSync(zshrc, "utf8")).toBe("before\n\n");
    writeFileSync(swarm, "unrelated");
    removeLegacySwarmLauncher(root);
    expect(readFileSync(swarm, "utf8")).toBe("unrelated");
  } finally {
    rmSync(root, { recursive: true });
  }
});

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
