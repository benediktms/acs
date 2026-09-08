#!/usr/bin/env bun
import { chmodSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createConnection } from "node:net";
import { handleA2A } from "../../../packages/protocol-a2a/src/index";
import { controlCall, controlHandler } from "../../../packages/protocol-control/src/index";
import { runMcp } from "../../../packages/bridge-mcp-codex/src/index";
import { initFiles, Store } from "../../../packages/storage-sqlite/src/index";
import {
  CodexCallerAttestor,
  CodexRuntimeAdapter,
  SUPPORTED_CODEX_VERSIONS,
  TESTED_CODEX_VERSION,
} from "../../../packages/runtime-codex/src/index";
import { DeliveryScheduler } from "../../../packages/application/src/scheduler";
import {
  canonicalCodexHome,
  loadConfig,
  migrateCodexAccounts,
  parseListen,
  paths,
  writeDefaultConfig,
} from "../../../packages/config/src/index";
import { pickSession, type SessionChoice } from "./session-picker";
import {
  installCodexAppServer,
  installCodexZshIntegration,
  installService,
  persistentEnvironment,
  removeCodexAppServers,
  restartCodexAppServer,
} from "./service";

const args = Bun.argv.slice(2),
  config = paths(),
  settings = loadConfig(),
  listen = parseListen(settings.daemon.a2aListen),
  port = listen.port;

async function main() {
  if (!args.length || args[0] === "--help" || args[0] === "help") return usage();
  if (args[0] === "init") {
    writeDefaultConfig();
    migrateCodexAccounts();
    initFiles(config);
    if (process.platform === "darwin" && !args.includes("--no-service")) {
      await installService({
        command: selfCommand(),
        environment: serviceEnvironment(),
        home: required(process.env.HOME, "HOME"),
        uid: required(process.getuid?.(), "user ID"),
        stopUnmanagedDaemon,
      });
      if (settings.codex.enabled) {
        removeCodexAppServers({
          labels: settings.codex.accounts.map((account) => account.label),
          userHome: required(process.env.HOME, "HOME"),
          uid: required(process.getuid?.(), "user ID"),
        });
        for (const account of settings.codex.accounts) {
          await installCodexAppServer({
            binary: required(
              Bun.which(settings.codex.binary) ?? settings.codex.binary,
              "Codex binary",
            ),
            home: account.home,
            socket: account.socket,
            label: account.label,
            userHome: required(process.env.HOME, "HOME"),
            uid: required(process.getuid?.(), "user ID"),
            socketOccupied: () => socketListening(account.socket),
          });
          installMcp(account.home);
        }
        installCodexZshIntegration(required(process.env.HOME, "HOME"), selfCommand());
      }
      await waitForDaemon();
      console.log("ACS login service and global Codex MCP are ready");
    }
    console.log(`Initialized ACS at ${config.data}`);
    return;
  }
  if (args[0] === "daemon" && (args[1] === "run" || args[1] === "start")) return daemon();
  if (args[0] === "mcp" && args[1] === "codex") return runMcp(port);
  if (args[0] === "codex" && args[1] === "run") {
    if (args[2] !== "--") throw new Error("Usage: acs codex run -- <codex arguments>");
    const child = Bun.spawn([settings.codex.binary, ...args.slice(3)], {
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exitCode = await child.exited;
    return;
  }
  if (args[0] === "codex" && args[1] === "doctor") return doctor();
  if (args[0] === "codex" && args[1] === "socket") {
    const home = canonicalCodexHome(
        process.env.CODEX_HOME ?? `${required(process.env.HOME, "HOME")}/.codex`,
      ),
      account = settings.codex.accounts.find((candidate) => candidate.home === home);
    if (!account) throw new Error("CODEX_ACCOUNT_UNCONFIGURED");
    console.log(account.socket);
    return;
  }
  if (args[0] === "codex" && args[1] === "install-mcp") {
    installMcp();
    return;
  }
  if (args[0] === "codex" && args[1] === "app-server" && args[2] === "restart") {
    restartCodexAppServer({
      label: required(args[3], "account label"),
      uid: required(process.getuid?.(), "user ID"),
    });
    return;
  }
  if (args[0] === "codex" && args[1] === "app-server" && args[2] === "adopt")
    return adoptCodexAppServer(required(args[3], "account label"), args.includes("--force"));
  const call = (method: string, params: unknown = {}) =>
    controlCall(config.runtime, config.token, method, params);
  await call("system.initialize", {
    protocolVersion: "1.0",
    client: { name: "acs-cli", version: "0.1.0", instanceId: String(process.pid) },
    capabilities: {},
  });
  if (args[0] === "codex" && args[1] === "bind") {
    const installationId = await accountInstallationId(call),
      agent = required(args[2], "agent"),
      explicitSession = option("--session"),
      session = explicitSession ?? (await chooseCodexSession(call, installationId));
    return print(await call("bindings.bind", bindingParams(agent, session, installationId)));
  }
  if (args[0] === "agents" && args[1] === "create") {
    const agent = required(args[2], "agent slug"),
      created = await call("agents.create", {
        slug: agent,
        displayName: option("--name"),
        description: option("--description"),
      });
    return print(
      args.includes("--claim")
        ? { created, claim: await call("agents.createClaim", { agent }) }
        : created,
    );
  }
  if (args[0] === "agents" && args[1] === "get")
    return print(await call("agents.get", { agent: required(args[2], "agent") }));
  if (args[0] === "agents" && args[1] === "update")
    return print(
      await call("agents.update", {
        agent: required(args[2], "agent"),
        slug: option("--slug"),
        displayName: option("--name"),
        description: option("--description"),
        enabled: args.includes("--enable") ? true : args.includes("--disable") ? false : undefined,
      }),
    );
  if (args[0] === "agents" && args[1] === "delete")
    return print(await call("agents.delete", { agent: required(args[2], "agent") }));
  if (args[0] === "agents" && args[1] === "list") return print(await call("agents.list"));
  if (args[0] === "bindings" && args[1] === "bind")
    return print(
      await call(
        "bindings.bind",
        bindingParams(
          required(args[2], "agent"),
          required(option("--session"), "--session"),
          await accountInstallationId(call),
        ),
      ),
    );
  if (args[0] === "bindings" && args[1] === "list") return print(await call("bindings.list"));
  if (args[0] === "bindings" && args[1] === "get")
    return print(await call("bindings.get", { bindingId: required(args[2], "binding ID") }));
  if (args[0] === "bindings" && args[1] === "revoke")
    return print(
      await call("bindings.revoke", {
        bindingId: required(args[2], "binding ID"),
        reason: option("--reason"),
      }),
    );
  if (args[0] === "runtimes" && args[1] === "list") return print(await call("runtimes.list"));
  if (args[0] === "codex" && args[1] === "sessions" && args[2] === "list")
    return print(
      await call("runtimes.sessions.list", { installationId: await accountInstallationId(call) }),
    );
  if (args[0] === "inbox") return print(await call("inbox.list", { agent: args[1] || undefined }));
  if (args[0] === "deliveries" && args[1] === "list") return print(await call("deliveries.list"));
  if (args[0] === "deliveries" && args[1] === "get")
    return print(await call("deliveries.get", { deliveryId: required(args[2], "delivery ID") }));
  if (args[0] === "deliveries" && args[1] === "retry")
    return print(await call("deliveries.retry", { deliveryId: required(args[2], "delivery ID") }));
  if (args[0] === "deliveries" && args[1] === "cancel")
    return print(
      await call("deliveries.cancel", {
        deliveryId: required(args[2], "delivery ID"),
        reason: option("--reason"),
      }),
    );
  if (args[0] === "deliveries" && args[1] === "resolve")
    return print(
      await call("deliveries.resolveUnknown", {
        deliveryId: required(args[2], "delivery ID"),
        resolution: resolutionOption(),
      }),
    );
  if (args[0] === "token" && args[1] === "show") {
    console.log(readFileSync(config.token, "utf8"));
    return;
  }
  throw new Error(`Unknown command: ${args.join(" ")}`);
}

function selfCommand() {
  return Bun.main.startsWith("/$bunfs/") ? [process.execPath] : [process.execPath, Bun.main];
}

function serviceEnvironment() {
  const environment: Record<string, string> = {};
  for (const key of [
    "HOME",
    "PATH",
    "TMPDIR",
    "CODEX_HOME",
    "ACS_HOME",
    "ACS_CONFIG_PATH",
    "ACS_CODEX_SOCKET",
    "ACS_A2A_PORT",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  environment.ACS_CONTROL_SOCKET = config.runtime;
  environment.ACS_STORAGE_PATH = config.data;
  environment.ACS_CODEX_BINARY = Bun.which(settings.codex.binary) ?? settings.codex.binary;
  return persistentEnvironment(environment);
}

function installMcp(codexHome = configuredCodexHome()) {
  const environment = { ...serviceEnvironment(), CODEX_HOME: codexHome },
    installed = Bun.spawnSync(
      [
        settings.codex.binary,
        "mcp",
        "add",
        "acs",
        ...Object.entries(environment).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        "--",
        ...selfCommand(),
        "mcp",
        "codex",
      ],
      { env: { ...process.env, CODEX_HOME: codexHome } },
    );
  if (!installed.success)
    throw new Error(installed.stderr.toString().trim() || "Codex MCP installation failed");
  process.stdout.write(installed.stdout);
}

function configuredCodexHome() {
  const home = process.env.CODEX_HOME;
  if (home) return canonicalCodexHome(home);
  return (
    settings.codex.accounts.find((account) => account.label === "local")?.home ??
    (settings.codex.accounts.length === 1 ? settings.codex.accounts[0]?.home : undefined) ??
    required(undefined, "CODEX_HOME or a local Codex account")
  );
}

async function waitForDaemon() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await controlCall(config.runtime, config.token, "system.initialize", {
        protocolVersion: "1.0",
        client: { name: "acs-init", version: "0.1.0", instanceId: String(process.pid) },
        capabilities: {},
      });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
  throw new Error("ACS service did not become ready; check ~/Library/Logs/acs.log");
}

async function stopUnmanagedDaemon() {
  if (!(await socketListening(config.runtime))) return;
  await controlCall(config.runtime, config.token, "system.shutdown", {});
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!existsSync(config.runtime)) return;
    await Bun.sleep(100);
  }
  throw new Error("Existing ACS daemon did not stop; service installation aborted");
}

async function adoptCodexAppServer(label: string, force: boolean) {
  const account = settings.codex.accounts.find((candidate) => candidate.label === label);
  if (!account) throw new Error(`CODEX_ACCOUNT_UNCONFIGURED: ${label}`);
  const stopped = Bun.spawnSync([settings.codex.binary, "app-server", "daemon", "stop"], {
    env: { ...process.env, CODEX_HOME: account.home },
  });
  if (!stopped.success && !force)
    throw new Error(
      stopped.stderr.toString().trim() || "Codex app-server stop failed; retry with --force",
    );
  if (!stopped.success) {
    if (!(await stopOwnedCodexAppServer(label, account.home, account.socket, "SIGTERM"))) return;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!(await socketListening(account.socket))) {
      await installCodexAppServer({
        binary: required(Bun.which(settings.codex.binary) ?? settings.codex.binary, "Codex binary"),
        home: account.home,
        socket: account.socket,
        label,
        userHome: required(process.env.HOME, "HOME"),
        uid: required(process.getuid?.(), "user ID"),
        socketOccupied: () => socketListening(account.socket),
      });
      return;
    }
    await Bun.sleep(100);
  }
  if (!force) throw new Error("Codex app-server did not stop; retry with --force");
  if (!(await stopOwnedCodexAppServer(label, account.home, account.socket, "SIGKILL"))) return;
  await installCodexAppServer({
    binary: required(Bun.which(settings.codex.binary) ?? settings.codex.binary, "Codex binary"),
    home: account.home,
    socket: account.socket,
    label,
    userHome: required(process.env.HOME, "HOME"),
    uid: required(process.getuid?.(), "user ID"),
    socketOccupied: () => socketListening(account.socket),
  });
}

async function stopOwnedCodexAppServer(
  label: string,
  home: string,
  socket: string,
  signal: "SIGTERM" | "SIGKILL",
) {
  const pid = listenerPid(socket),
    details = pid ? processDetails(pid) : "";
  if (!pid) throw new Error("CODEX_APP_SERVER_NOT_FOUND");
  if (!details.includes("codex") || !details.includes(`CODEX_HOME=${home}`))
    throw new Error("CODEX_APP_SERVER_OWNERSHIP_UNVERIFIED");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("CODEX_APP_SERVER_FORCE_REQUIRES_TERMINAL");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (
      (
        await terminal.question(`Stop Codex PID ${pid} for ${label} (${socket})? [y/N] `)
      ).toLowerCase() !== "y"
    )
      return false;
  } finally {
    terminal.close();
  }
  process.kill(pid, signal);
  return true;
}

function listenerPid(socket: string) {
  const value = Bun.spawnSync(["/usr/sbin/lsof", "-nP", "-t", "-U", socket])
    .stdout.toString()
    .trim();
  return /^\d+$/.test(value) ? Number(value) : undefined;
}
function processDetails(pid: number) {
  return Bun.spawnSync(["/bin/ps", "eww", "-p", String(pid)]).stdout.toString();
}

function socketListening(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      if ("code" in error && ["ENOENT", "ECONNREFUSED"].includes(String(error.code)))
        resolve(false);
      else reject(error);
    });
  });
}

async function daemon() {
  const store = new Store(config, {
      maxInlineContentBytes: settings.security.maxInlineContentBytes,
      maxParts: settings.security.maxParts,
      maxTextPartBytes: settings.security.maxTextPartBytes,
      claimTtlSeconds: settings.security.claimTtlSeconds,
      busyTimeoutMs: settings.storage.busyTimeoutMs,
      durability: settings.storage.durability,
      maxQueuedDeliveryIntents: settings.delivery.maxQueuedDeliveryIntents,
    }),
    startedAt = new Date().toISOString();
  if (await socketListening(config.runtime))
    throw new Error("ACS daemon is already running; use acs init to update its service");
  let schedulers: DeliveryScheduler[] = [];
  const a2a = Bun.serve({
    hostname: listen.hostname,
    port,
    fetch: (request) =>
      handleA2A(store, request, port, {
        maxRequestBytes: settings.security.maxRequestBytes,
        signalDelivery: () => schedulers.forEach((scheduler) => scheduler.signal()),
        hostname: listen.hostname,
        reportInternalError: ({ error, correlationId }) =>
          log("error", "a2a.internal_error", String(process.pid), {
            correlationId,
            code: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN",
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
    error: (error) => sanitizedError(error, String(process.pid)),
  });
  if (existsSync(config.runtime)) unlinkSync(config.runtime);
  let control: ReturnType<typeof Bun.serve>;
  let finish: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const installations = store.syncCodexInstallations(settings.codex.accounts),
    adapters = new Map<`ins_${string}`, CodexRuntimeAdapter>(),
    callerAttestors = new Map<`ins_${string}`, CodexCallerAttestor>();
  if (settings.codex.enabled)
    for (const account of settings.codex.accounts) {
      const installation = required(
        installations.find((candidate) => candidate.label === account.label),
        `runtime installation ${account.label}`,
      );
      adapters.set(
        installation.id,
        new CodexRuntimeAdapter(account.socket, settings.codex.maxInFlightRequests, account.home),
      );
      callerAttestors.set(installation.id, new CodexCallerAttestor(installation.id));
    }
  schedulers = [...adapters].map(
    ([installationId, adapter]) =>
      new DeliveryScheduler(
        store,
        adapter,
        String(process.pid),
        {
          concurrency: settings.delivery.workerConcurrency,
          leaseMs: settings.delivery.leaseSeconds * 1000,
          retryBaseMs: settings.delivery.retryBaseMs,
          retryCapMs: settings.delivery.retryCapMs,
          reconnectMs: settings.codex.statusPollIntervalMs,
        },
        installationId,
      ),
  );
  await Promise.all(schedulers.map((scheduler) => scheduler.start()));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      let forceTimer: Timer | undefined;
      const serversStopped = Promise.all([a2a.stop(), control.stop()]),
        forcedClosed = new Promise<void>((resolve) => {
          forceTimer = setTimeout(() => {
            void a2a.stop(true);
            void control.stop(true);
            resolve();
          }, 1000);
        });
      try {
        await Promise.all(schedulers.map((scheduler) => scheduler.stop()));
        await Promise.race([serversStopped, forcedClosed]);
      } catch (error) {
        sanitizedError(
          error instanceof Error ? error : new Error(String(error)),
          String(process.pid),
        );
      } finally {
        if (forceTimer) clearTimeout(forceTimer);
        store.close();
        if (existsSync(config.runtime)) unlinkSync(config.runtime);
        finish?.();
      }
    })();
  };
  control = Bun.serve({
    unix: config.runtime,
    fetch: controlHandler(store, startedAt, stop, adapters, callerAttestors),
    error: (error) => sanitizedError(error, String(process.pid)),
  });
  chmodSync(config.runtime, 0o600);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  log("info", "daemon.started", String(process.pid), {
    a2a: a2a.url.origin,
    control: "ready",
  });
  await stopped;
}

function sanitizedError(error: Error, instanceId: string) {
  log("error", "daemon.error", instanceId, { code: error.message.split(":")[0] });
  return Response.json({ error: "internal" }, { status: 500 });
}
function log(
  severity: "info" | "error",
  event: string,
  daemonInstanceId: string,
  attributes: Record<string, unknown>,
) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levels[severity] < levels[settings.daemon.logLevel]) return;
  const record = {
    timestamp: new Date().toISOString(),
    severity,
    daemonInstanceId,
    event,
    ...attributes,
  };
  console.error(
    settings.daemon.logFormat === "json"
      ? JSON.stringify(record)
      : Object.entries(record)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(" "),
  );
}
function option(name: string) {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}
function resolutionOption() {
  const resolutions = [
    ["--accepted", "accepted"],
    ["--not-accepted-and-retry", "not-accepted-and-retry"],
    ["--not-accepted-and-cancel", "not-accepted-and-cancel"],
  ].filter(([flag]) => args.includes(flag));
  if (resolutions.length !== 1) throw new Error("Specify exactly one delivery resolution flag");
  return required(resolutions[0]?.[1], "delivery resolution");
}
function required<T>(value: T | null | undefined, name: string): T {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
function bindingParams(
  agent: string,
  session: string | { readonly installationId: string; readonly opaqueId: string },
  installationId?: string,
) {
  return {
    agent,
    session,
    continuityPolicy: option("--continuity") ?? "follow-pending",
    deliveryPolicy: { interruptOnCancel: true },
    revokeExisting: args.includes("--revoke-existing"),
    installationId,
  };
}
async function accountInstallationId(call: (method: string, params?: unknown) => Promise<unknown>) {
  const home = canonicalCodexHome(
      process.env.CODEX_HOME ?? `${required(process.env.HOME, "HOME")}/.codex`,
    ),
    label =
      option("--account") ??
      settings.codex.accounts.find((candidate) => candidate.home === home)?.label;
  if (!label) throw new Error("CODEX_ACCOUNT_UNCONFIGURED: set CODEX_HOME or use --account");
  const account = settings.codex.accounts.find((candidate) => candidate.label === label);
  if (!account) throw new Error(`CODEX_ACCOUNT_UNCONFIGURED: ${label}`);
  let cursor: string | undefined, installationId: unknown;
  do {
    const runtimes = recordValue(await call("runtimes.list", { limit: 100, cursor })),
      runtime = arrayValue(runtimes.runtimes).find(
        (item) => recordValue(item).label === account.label,
      );
    installationId = runtime ? recordValue(runtime).installationId : undefined;
    cursor = typeof runtimes.nextCursor === "string" ? runtimes.nextCursor : undefined;
  } while (typeof installationId !== "string" && cursor);
  if (typeof installationId !== "string") throw new Error(`RUNTIME_UNAVAILABLE: ${label}`);
  return installationId;
}
async function chooseCodexSession(
  call: (method: string, params?: unknown) => Promise<unknown>,
  installationId: string,
) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Interactive Codex binding requires a terminal; use --session for automation");
  const sessions = new Array<SessionChoice>();
  let cursor: string | undefined;
  do {
    const page = recordValue(
      await call("runtimes.sessions.list", { installationId, cursor, limit: 100 }),
    );
    sessions.push(...sessionChoices(page.sessions));
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
  } while (cursor);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await pickSession(sessions, (prompt) => terminal.question(prompt));
  } finally {
    terminal.close();
  }
}
function sessionChoices(value: unknown): SessionChoice[] {
  if (!Array.isArray(value)) throw new Error("Invalid runtime session list");
  return value.map((item) => {
    const snapshot = recordValue(item),
      session = recordValue(snapshot.session),
      attributes = recordValue(snapshot.attributes);
    if (
      typeof session.installationId !== "string" ||
      typeof session.opaqueId !== "string" ||
      typeof snapshot.availability !== "string"
    )
      throw new Error("Invalid runtime session");
    return {
      session: { installationId: session.installationId, opaqueId: session.opaqueId },
      availability: snapshot.availability,
      title: typeof attributes.displayTitle === "string" ? attributes.displayTitle : undefined,
      cwd: typeof attributes.cwdHint === "string" ? attributes.cwdHint : undefined,
    };
  });
}
async function doctor() {
  const codex = Bun.spawnSync([settings.codex.binary, "--version"]);
  const installedCodex = codex.success ? codex.stdout.toString().trim() : undefined,
    call = (method: string, params: unknown = {}) =>
      controlCall(config.runtime, config.token, method, params);
  let accountHealth: unknown[] = [],
    directDelivery = false;
  try {
    await call("system.initialize", {
      protocolVersion: "1.0",
      client: { name: "acs-doctor", version: "0.1.0", instanceId: String(process.pid) },
      capabilities: {},
    });
    const runtimes = recordValue(await call("runtimes.list", { limit: 100 }));
    accountHealth = await Promise.all(
      arrayValue(runtimes.runtimes).map(async (runtime) => {
        const value = recordValue(runtime),
          installationId = required(value.installationId, "installation ID");
        try {
          const probe = recordValue(
              recordValue(await call("runtimes.probe", { installationId })).probe,
            ),
            sessions = recordValue(
              await call("runtimes.sessions.list", { installationId, limit: 1 }),
            ).sessions,
            capabilities = recordValue(probe.capabilities);
          directDelivery ||= capabilities.directDelivery === true;
          return {
            label: value.label,
            installationId,
            socket: settings.codex.accounts.find((account) => account.label === value.label)
              ?.socket,
            state: probe.state,
            version: probe.runtimeVersion,
            directDelivery: capabilities.directDelivery === true,
            threadsSampled: Array.isArray(sessions) ? sessions.length : 0,
          };
        } catch (error) {
          return { label: value.label, installationId, state: "unavailable", error: String(error) };
        }
      }),
    );
  } catch (error) {
    accountHealth = [{ state: "unavailable", error: String(error) }];
  }
  print({
    codex: {
      installed: installedCodex ?? "unavailable",
      testedVersion: TESTED_CODEX_VERSION,
      supportedVersions: SUPPORTED_CODEX_VERSIONS,
      accounts: accountHealth,
    },
    phaseZero: {
      a2aOnBun: "verified by pinned TCK",
      standaloneExecutable: "verified by clean-machine release matrix",
      mcpAttestation: "verified on Codex 0.153.2 and 0.153.4",
      directDelivery: "named tool-output submission is the only automatic peer-message path",
      deliveryReconciliation:
        "exact delivery markers are required; inconclusive writes remain operator-owned",
      approvalOwnership:
        "verified: user approvals remain TUI-owned; ACS never answers local-input requests",
    },
    mutatingDeliveryEnabled: Boolean(
      accountHealth.some((account) => {
        const value = recordValue(account);
        return (
          typeof value.version === "string" &&
          SUPPORTED_CODEX_VERSIONS.includes(value.version) &&
          value.state === "ready"
        );
      }) && directDelivery,
    ),
  });
}
function recordValue(value: unknown): Record<string, unknown> {
  if (!isRecordValue(value)) throw new Error("Invalid control response");
  return value;
}
function arrayValue(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid control response");
  return value;
}
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function usage() {
  console.log(
    `ACS 0.1.0\n\n  acs init\n  acs daemon start\n  acs agents create <slug> [--claim] [--name name] [--description text]\n  acs agents get|delete <agent>\n  acs agents update <agent> [--slug slug] [--name name] [--description text] [--enable|--disable]\n  acs agents list\n  acs codex sessions list\n  acs codex bind <agent> [--session <codex-thread-id>] [--continuity follow-pending|strict] [--revoke-existing]\n  acs bindings bind <agent> --session <codex-thread-id> [--continuity follow-pending|strict] [--revoke-existing]\n  acs bindings get|revoke <binding-id>\n  acs bindings list\n  acs runtimes list\n  acs inbox [agent]\n  acs deliveries list|get|retry|cancel <delivery-id>\n  acs deliveries resolve <delivery-id> --accepted|--not-accepted-and-retry|--not-accepted-and-cancel\n  acs token show\n  acs codex doctor\n  acs codex install-mcp\n  acs mcp codex`,
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
