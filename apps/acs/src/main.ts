#!/usr/bin/env bun
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { createConnection } from "node:net";
import { Database } from "bun:sqlite";
import { Command, Option } from "commander";
import { handleA2A } from "../../../packages/protocol-a2a/src/index";
import { controlCall, controlHandler } from "../../../packages/protocol-control/src/index";
import { isConfiguredCodexRuntime, runMcp } from "../../../packages/bridge-mcp-codex/src/index";
import { initFiles, Store } from "../../../packages/storage-sqlite/src/index";
import {
  CodexCallerAttestor,
  CodexRuntimeAdapter,
  SUPPORTED_CODEX_VERSIONS,
  TESTED_CODEX_VERSION,
} from "../../../packages/runtime-codex/src/index";
import {
  DeliveryConcurrency,
  DeliveryScheduler,
} from "../../../packages/application/src/scheduler";
import {
  canonicalCodexHome,
  configPath,
  loadConfig,
  migrateCodexAccounts,
  parseListen,
  paths,
  writeDefaultConfig,
} from "../../../packages/config/src/index";
import { pickSession, type SessionChoice } from "./session-picker";
import {
  daemonCommandRunsForeground,
  daemonCommandWaitsForHandover,
  type DaemonControlPaths,
  daemonServiceStatus,
  installCodexAppServer,
  installService,
  installedDaemonControlPaths,
  ownedCodexAppServerPid,
  persistentEnvironment,
  removeCodexAppServers,
  restartDaemonService,
  restartCodexAppServer,
  removeLegacySwarmLauncher,
  startDaemonService,
  stopDaemonService,
  stopUnmanagedDaemon,
} from "./service";

const args = Bun.argv.slice(2);
let config: ReturnType<typeof paths>,
  settings: ReturnType<typeof loadConfig>,
  listen: ReturnType<typeof parseListen>,
  port: number;

async function main() {
  const program = new Command()
    .name("acs")
    .description("Agent Communications Service")
    .addHelpText(
      "after",
      "\nDaemon status exits 0 when control-ready, 1 when stopped, and 2 when unavailable.",
    )
    .showHelpAfterError();

  program
    .command("help [command...]")
    .description("display help for command")
    .action((path: string[] = []) => {
      let command = program;
      for (const name of path) {
        const child = command.commands.find((candidate) => candidate.name() === name);
        if (!child) return command.error(`error: unknown command '${name}'`);
        command = child;
      }
      command.outputHelp();
    });

  program
    .command("init")
    .description("initialize ACS configuration and local files")
    .option("--no-service", "skip macOS LaunchAgent installation")
    .action(async (options: { service?: boolean }) => {
      await loadSettingsResources();
      writeDefaultConfig();
      migrateCodexAccounts();
      initFiles(config);
      removeLegacySwarmLauncher(required(process.env.HOME, "HOME"));
      if (process.platform === "darwin" && options.service !== false) {
        await installService({
          command: selfCommand(),
          environment: serviceEnvironment(),
          home: required(process.env.HOME, "HOME"),
          uid: required(process.getuid?.(), "user ID"),
          stopUnmanagedDaemon: async () => {
            await stopUnmanagedDaemonAt();
            await waitForDaemonStop();
          },
        });
        removeCodexAppServers({
          labels: settings.codex.enabled
            ? settings.codex.accounts.map((account) => account.label)
            : [],
          userHome: required(process.env.HOME, "HOME"),
          uid: required(process.getuid?.(), "user ID"),
        });
        if (settings.codex.enabled && settings.codex.accounts.length) {
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
        }
        await waitForDaemon();
        console.log("ACS login service and global Codex MCP are ready");
      }
      console.log(`Initialized ACS at ${config.data}`);
    });

  const daemonGroup = program.command("daemon").description("run and control the ACS daemon");
  daemonGroup
    .command("run")
    .description("run the daemon in the foreground")
    .action(async () => {
      await loadRuntimeResources();
      await daemon();
    });
  for (const command of ["start", "stop", "status", "restart"] as const)
    daemonGroup
      .command(command)
      .description(`${command} the macOS LaunchAgent daemon`)
      .action(async () => {
        if (daemonCommandRunsForeground(command)) await loadRuntimeResources();
        else loadControlPaths();
        if (daemonCommandRunsForeground(command)) return daemon();
        await daemonLifecycle(command);
      });

  const agents = program.command("agents").description("manage ACS agents");
  agents
    .command("create <slug>")
    .description("create an agent")
    .option("--claim", "create a claim code")
    .option("--name <name>", "display name")
    .option("--description <text>", "agent description")
    .action(
      async (slug: string, options: { claim?: boolean; name?: string; description?: string }) => {
        const call = await controlClient(),
          created = await call("agents.create", {
            slug,
            displayName: options.name,
            description: options.description,
          });
        print(
          options.claim
            ? { created, claim: await call("agents.createClaim", { agent: slug }) }
            : created,
        );
      },
    );
  agents
    .command("get <agent>")
    .description("get an agent")
    .action(async (agent: string) => print(await (await controlClient())("agents.get", { agent })));
  agents
    .command("update <agent>")
    .description("update an agent")
    .option("--slug <slug>", "new slug")
    .option("--name <name>", "display name")
    .option("--description <text>", "agent description")
    .addOption(new Option("--enable", "enable the agent").conflicts("disable"))
    .addOption(new Option("--disable", "disable the agent").conflicts("enable"))
    .action(
      async (
        agent: string,
        options: {
          slug?: string;
          name?: string;
          description?: string;
          enable?: boolean;
          disable?: boolean;
        },
      ) =>
        print(
          await (
            await controlClient()
          )("agents.update", {
            agent,
            slug: options.slug,
            displayName: options.name,
            description: options.description,
            enabled: options.enable ? true : options.disable ? false : undefined,
          }),
        ),
    );
  agents
    .command("delete <agent>")
    .description("delete an agent")
    .action(async (agent: string) =>
      print(await (await controlClient())("agents.delete", { agent })),
    );
  agents
    .command("list")
    .description("list agents")
    .action(async () => print(await (await controlClient())("agents.list")));

  const bindings = program.command("bindings").description("manage agent bindings");
  bindingOptions(
    bindings.command("bind <agent>").description("bind an agent to a Codex session"),
    true,
  ).action(async (agent: string, options: BindingOptions) => {
    await loadSettingsResources();
    const call = await controlClient();
    print(
      await call(
        "bindings.bind",
        bindingParams(
          agent,
          required(options.session, "--session"),
          await accountInstallationId(call, options.account),
          options,
        ),
      ),
    );
  });
  bindings
    .command("get <binding-id>")
    .description("get a binding")
    .action(async (bindingId: string) =>
      print(await (await controlClient())("bindings.get", { bindingId })),
    );
  bindings
    .command("revoke <binding-id>")
    .description("revoke a binding")
    .option("--reason <text>", "revocation reason")
    .action(async (bindingId: string, options: { reason?: string }) =>
      print(
        await (
          await controlClient()
        )("bindings.revoke", { bindingId, reason: options.reason }),
      ),
    );
  bindings
    .command("list")
    .description("list bindings")
    .action(async () => print(await (await controlClient())("bindings.list")));

  program
    .command("runtimes")
    .description("inspect runtimes")
    .command("list")
    .description("list runtimes")
    .action(async () => print(await (await controlClient())("runtimes.list")));
  program
    .command("inbox [agent]")
    .description("list inbox tasks")
    .action(async (agent?: string) =>
      print(await (await controlClient())("inbox.list", { agent })),
    );

  const deliveries = program.command("deliveries").description("manage deliveries");
  deliveries
    .command("list")
    .description("list deliveries")
    .action(async () => print(await (await controlClient())("deliveries.list")));
  for (const command of ["get", "retry"] as const)
    deliveries
      .command(`${command} <delivery-id>`)
      .description(`${command} a delivery`)
      .action(async (deliveryId: string) =>
        print(await (await controlClient())(`deliveries.${command}`, { deliveryId })),
      );
  deliveries
    .command("cancel <delivery-id>")
    .description("cancel a delivery")
    .option("--reason <text>", "cancellation reason")
    .action(async (deliveryId: string, options: { reason?: string }) =>
      print(
        await (
          await controlClient()
        )("deliveries.cancel", { deliveryId, reason: options.reason }),
      ),
    );
  deliveries
    .command("resolve <delivery-id>")
    .description("resolve an unknown delivery")
    .addOption(
      new Option("--accepted", "mark accepted").conflicts([
        "notAcceptedAndRetry",
        "notAcceptedAndCancel",
      ]),
    )
    .addOption(
      new Option("--not-accepted-and-retry", "mark not accepted and retry").conflicts([
        "accepted",
        "notAcceptedAndCancel",
      ]),
    )
    .addOption(
      new Option("--not-accepted-and-cancel", "mark not accepted and cancel").conflicts([
        "accepted",
        "notAcceptedAndRetry",
      ]),
    )
    .action(async (deliveryId: string, options: ResolutionOptions) => {
      const resolution = resolutionOption(options);
      print(await (await controlClient())("deliveries.resolveUnknown", { deliveryId, resolution }));
    });

  program
    .command("token")
    .description("manage access tokens")
    .command("show")
    .description("show the control token")
    .action(async () => {
      loadControlPaths();
      console.log(readFileSync(config.token, "utf8"));
    });
  program
    .command("mcp")
    .description("run MCP transports")
    .command("codex")
    .description("run the Codex MCP server")
    .action(async () => {
      await loadRuntimeResources();
      await runMcp(port);
    });

  const codex = program
    .command("codex")
    .description("manage Codex integration")
    .enablePositionalOptions();
  codex
    .command("run")
    .description("run Codex with arguments after --")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .passThroughOptions()
    .action(async (_options: Record<string, never>, command: Command) => {
      if (args[2] !== "--") throw new Error("Usage: acs codex run -- <codex arguments>");
      const tail = command.args,
        boundary = tail.indexOf("--"),
        launchArguments = boundary < 0 ? tail : tail.slice(0, boundary);
      if (
        launchArguments.some(
          (argument) => argument === "--remote" || argument.startsWith("--remote="),
        )
      ) {
        process.exitCode = 2;
        throw new Error("ACS: codex run owns --remote; remove it and retry");
      }
      await loadSettingsResources();
      const home = canonicalCodexHome(
          process.env.CODEX_HOME ?? `${required(process.env.HOME, "HOME")}/.codex`,
        ),
        account = settings.codex.accounts.find((candidate) => candidate.home === home);
      if (!account) {
        process.exitCode = 2;
        throw new Error("CODEX_ACCOUNT_UNCONFIGURED");
      }
      if (!(await socketListening(account.socket))) {
        process.exitCode = 2;
        throw new Error(
          "ACS: managed Codex app-server is unavailable; run acs init or acs codex app-server restart <account-label>",
        );
      }
      const hasCurrentDirectory = launchArguments.some(
        (argument) =>
          argument === "-C" ||
          argument === "--cd" ||
          (argument.startsWith("-C") && argument.length > 2) ||
          argument.startsWith("--cd="),
      );
      const child = Bun.spawn(
        [
          settings.codex.binary,
          "--remote",
          `unix://${account.socket}`,
          ...(hasCurrentDirectory ? [] : ["--cd", process.cwd()]),
          ...tail,
        ],
        {
          env: process.env,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      process.exitCode = await child.exited;
    });
  codex
    .command("doctor")
    .description("report Codex integration health")
    .action(async () => {
      await loadSettingsResources();
      await doctor();
    });
  codex
    .command("socket")
    .description("print the configured Codex socket")
    .action(async () => {
      await loadSettingsResources();
      const home = canonicalCodexHome(
          process.env.CODEX_HOME ?? `${required(process.env.HOME, "HOME")}/.codex`,
        ),
        account = settings.codex.accounts.find((candidate) => candidate.home === home);
      if (!account) throw new Error("CODEX_ACCOUNT_UNCONFIGURED");
      console.log(account.socket);
    });
  codex
    .command("install-mcp")
    .description("install ACS as a Codex MCP server")
    .action(async () => {
      await loadSettingsResources();
      installMcp();
    });
  const appServer = codex.command("app-server").description("manage Codex app servers");
  appServer
    .command("restart <account-label>")
    .description("restart an app server")
    .action(async (label: string) => {
      await loadSettingsResources();
      restartCodexAppServer({
        label,
        uid: required(process.getuid?.(), "user ID"),
      });
    });
  appServer
    .command("adopt <account-label>")
    .description("adopt an existing app server")
    .option("--force", "force replacement after confirmation")
    .action(async (label: string, options: { force?: boolean }) => {
      await loadSettingsResources();
      await adoptCodexAppServer(label, Boolean(options.force));
    });

  bindingOptions(
    codex.command("bind <agent>").description("bind an agent to a Codex session"),
    false,
  ).action(async (agent: string, options: BindingOptions) => {
    await loadSettingsResources();
    const call = await controlClient(),
      installationId = await accountInstallationId(call, options.account),
      session = options.session ?? (await chooseCodexSession(call, installationId));
    print(await call("bindings.bind", bindingParams(agent, session, installationId, options)));
  });
  codex
    .command("sessions")
    .description("inspect Codex sessions")
    .command("list")
    .description("list Codex sessions")
    .option("--account <label>", "Codex account label")
    .action(async (options: { account?: string }) => {
      await loadSettingsResources();
      const call = await controlClient();
      print(
        await call("runtimes.sessions.list", {
          installationId: await accountInstallationId(call, options.account),
        }),
      );
    });

  program.action(() => program.outputHelp());
  await program.parseAsync(args, { from: "user" });
}

type BindingOptions = {
  session?: string;
  continuity?: "follow-pending" | "strict";
  revokeExisting?: boolean;
  account?: string;
};
type ResolutionOptions = {
  accepted?: boolean;
  notAcceptedAndRetry?: boolean;
  notAcceptedAndCancel?: boolean;
};

function bindingOptions(command: Command, sessionRequired: boolean) {
  return command
    .addOption(
      sessionRequired
        ? new Option("--session <thread-id>", "Codex thread ID").makeOptionMandatory()
        : new Option("--session <thread-id>", "Codex thread ID"),
    )
    .addOption(
      new Option("--continuity <policy>", "binding continuity").choices([
        "follow-pending",
        "strict",
      ]),
    )
    .option("--revoke-existing", "revoke existing binding")
    .option("--account <label>", "Codex account label");
}

function loadControlPaths() {
  config = paths();
}
async function loadSettingsResources() {
  loadControlPaths();
  migrateCodexAccounts(configPath());
  settings = loadConfig();
}
async function loadRuntimeResources() {
  await loadSettingsResources();
  listen = parseListen(settings.daemon.a2aListen);
  port = listen.port;
}
async function controlClient() {
  loadControlPaths();
  const call = (method: string, params: unknown = {}) =>
    controlCall(config.runtime, config.token, method, params);
  await call("system.initialize", {
    protocolVersion: "1.0",
    client: { name: "acs-cli", version: "0.1.0", instanceId: String(process.pid) },
    capabilities: {},
  });
  return call;
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

async function waitForDaemon(control: DaemonControlPaths = config) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (await controlReady(control)) return;
    if (Date.now() >= deadline) break;
    await Bun.sleep(100);
  }
  throw new Error("ACS service did not become ready; check ~/Library/Logs/acs.log");
}

async function waitForDaemonStop(control: DaemonControlPaths = config) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (!(await socketListening(control.runtime))) return;
    if (Date.now() >= deadline) break;
    await Bun.sleep(100);
  }
  throw new Error("ACS daemon did not stop; check ~/Library/Logs/acs.log");
}

async function daemonLifecycle(command: string) {
  if (process.platform !== "darwin")
    throw new Error(
      "daemon lifecycle commands require macOS; run acs daemon run under your service manager",
    );
  const home = required(process.env.HOME, "HOME"),
    control = installedDaemonControlPaths(home, config),
    options = {
      home,
      uid: required(process.getuid?.(), "user ID"),
      waitUntilReady: () => waitForDaemon(control),
      waitUntilStopped: () => waitForDaemonStop(control),
      stopUnmanagedDaemon: () => stopUnmanagedDaemonAt(control),
      isSocketOccupied: () => socketListening(control.runtime),
      isControlReady: () => controlReady(control),
    };
  if (command === "start") {
    console.log(`ACS service ${await startDaemonService(options)} is ready`);
    return;
  }
  if (command === "stop") return stopDaemonService(options);
  if (command === "restart") {
    console.log(`ACS service ${await restartDaemonService(options)} is ready`);
    return;
  }
  const status = await daemonServiceStatus(options);
  console.log(status.state);
  process.exitCode = status.exitCode;
}

async function controlReady(control: DaemonControlPaths = config) {
  try {
    await controlCall(
      control.runtime,
      control.token,
      "system.initialize",
      {
        protocolVersion: "1.0",
        client: { name: "acs-cli", version: "0.1.0", instanceId: String(process.pid) },
        capabilities: {},
      },
      1,
    );
    return true;
  } catch {
    return false;
  }
}

async function stopUnmanagedDaemonAt(control: DaemonControlPaths = config) {
  await stopUnmanagedDaemon(
    () => socketListening(control.runtime),
    () => controlCall(control.runtime, control.token, "system.shutdown", {}, 5),
  );
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
  } else if (await socketListening(account.socket)) {
    const pid = ownedCodexAppServerPid(account.home, account.socket);
    if (pid) process.kill(pid, "SIGTERM");
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
  const pid = ownedCodexAppServerPid(home, socket);
  if (!pid) throw new Error("CODEX_APP_SERVER_NOT_FOUND");
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

function socketListening(path: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolve(false);
    });
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
  const lock = await acquireDaemonLock();
  let store: Store | undefined,
    a2a: ReturnType<typeof Bun.serve> | undefined,
    control: ReturnType<typeof Bun.serve> | undefined,
    schedulers: DeliveryScheduler[] = [];
  try {
    const daemonStore = new Store(config, {
        maxInlineContentBytes: settings.security.maxInlineContentBytes,
        maxParts: settings.security.maxParts,
        maxTextPartBytes: settings.security.maxTextPartBytes,
        claimTtlSeconds: settings.security.claimTtlSeconds,
        busyTimeoutMs: settings.storage.busyTimeoutMs,
        durability: settings.storage.durability,
        maxQueuedDeliveryIntents: settings.delivery.maxQueuedDeliveryIntents,
      }),
      startedAt = new Date().toISOString();
    store = daemonStore;
    a2a = Bun.serve({
      hostname: listen.hostname,
      port,
      fetch: (request) =>
        handleA2A(daemonStore, request, port, {
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
    let finish: (() => void) | undefined;
    const stopped = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const installations = daemonStore.syncCodexInstallations(
        settings.codex.enabled ? settings.codex.accounts : [],
      ),
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
    const deliveryConcurrency = new DeliveryConcurrency(settings.delivery.workerConcurrency);
    schedulers = [...adapters].map(
      ([installationId, adapter]) =>
        new DeliveryScheduler(
          daemonStore,
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
          deliveryConcurrency,
        ),
    );
    await Promise.all(schedulers.map((scheduler) => scheduler.start()));
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void (async () => {
        let forceTimer: Timer | undefined;
        const serversStopped = Promise.all([
            required(a2a, "A2A server").stop(),
            required(control, "control server").stop(),
          ]),
          forcedClosed = new Promise<void>((resolve) => {
            forceTimer = setTimeout(() => {
              void required(a2a, "A2A server").stop(true);
              void required(control, "control server").stop(true);
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
          try {
            try {
              daemonStore.close();
            } finally {
              try {
                if (existsSync(config.runtime)) unlinkSync(config.runtime);
              } finally {
                releaseDaemonLock(lock);
              }
            }
          } catch (error) {
            sanitizedError(
              error instanceof Error ? error : new Error(String(error)),
              String(process.pid),
            );
          } finally {
            finish?.();
          }
        }
      })();
    };
    control = Bun.serve({
      unix: config.runtime,
      fetch: controlHandler(daemonStore, startedAt, stop, adapters, callerAttestors),
      error: (error) => sanitizedError(error, String(process.pid)),
    });
    chmodSync(config.runtime, 0o600);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    log("info", "daemon.started", String(process.pid), {
      a2a: required(a2a, "A2A server").url.origin,
      control: "ready",
    });
    await stopped;
  } catch (error) {
    try {
      try {
        await Promise.allSettled(schedulers.map((scheduler) => scheduler.stop()));
      } finally {
        try {
          try {
            void a2a?.stop(true);
          } finally {
            void control?.stop(true);
          }
        } finally {
          try {
            store?.close();
          } finally {
            try {
              if (control && existsSync(config.runtime)) unlinkSync(config.runtime);
            } finally {
              releaseDaemonLock(lock);
            }
          }
        }
      }
    } catch (cleanupError) {
      sanitizedError(
        cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
        String(process.pid),
      );
    }
    throw error;
  }
}

async function acquireDaemonLock() {
  const path = `${dirname(config.token)}/daemon.lock.db`,
    directory = dirname(path),
    wait = daemonCommandWaitsForHandover(),
    deadline = Date.now() + 10_000;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const database = new Database(path, { create: true, strict: true });
  chmodSync(path, 0o600);
  for (;;) {
    try {
      database.exec(`PRAGMA busy_timeout=${wait ? 100 : 0}; BEGIN EXCLUSIVE`);
      return database;
    } catch (error) {
      if (!isLockContention(error)) {
        database.close();
        throw error;
      }
      if (!wait || Date.now() >= deadline) {
        database.close();
        throw new Error("ACS daemon is already running; use acs init to update its service", {
          cause: error,
        });
      }
      await Bun.sleep(100);
    }
  }
}

function releaseDaemonLock(database: Database) {
  if (database.inTransaction) database.exec("ROLLBACK");
  database.close();
}

function isLockContention(error: unknown) {
  return error instanceof Error && /database is (busy|locked)/i.test(error.message);
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
function resolutionOption(options: ResolutionOptions) {
  const resolutions = [
    [options.accepted, "accepted"],
    [options.notAcceptedAndRetry, "not-accepted-and-retry"],
    [options.notAcceptedAndCancel, "not-accepted-and-cancel"],
  ].filter(([enabled]) => enabled);
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
  options: BindingOptions = {},
) {
  return {
    agent,
    session,
    continuityPolicy: options.continuity ?? "follow-pending",
    deliveryPolicy: { interruptOnCancel: true },
    revokeExisting: Boolean(options.revokeExisting),
    installationId,
  };
}
async function accountInstallationId(
  call: (method: string, params?: unknown) => Promise<unknown>,
  accountLabel?: string,
) {
  const home = canonicalCodexHome(
      process.env.CODEX_HOME ?? `${required(process.env.HOME, "HOME")}/.codex`,
    ),
    label =
      accountLabel ?? settings.codex.accounts.find((candidate) => candidate.home === home)?.label;
  if (!label) throw new Error("CODEX_ACCOUNT_UNCONFIGURED: set CODEX_HOME or use --account");
  const account = settings.codex.accounts.find((candidate) => candidate.label === label);
  if (!account) throw new Error(`CODEX_ACCOUNT_UNCONFIGURED: ${label}`);
  let cursor: string | undefined, installationId: unknown;
  do {
    const runtimes = recordValue(await call("runtimes.list", { limit: 100, cursor })),
      runtime = arrayValue(runtimes.runtimes).find((item) =>
        isConfiguredCodexRuntime(item, account.label, account.home),
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
    const runtimes: unknown[] = [];
    let cursor: string | undefined;
    do {
      const page = recordValue(await call("runtimes.list", { limit: 100, cursor }));
      runtimes.push(...arrayValue(page.runtimes));
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
    } while (cursor);
    accountHealth = await Promise.all(
      settings.codex.accounts.map(async (account) => {
        const runtime = runtimes.find((candidate) => {
          const value = recordValue(candidate);
          return value.harnessId === "codex" && value.label === account.label;
        });
        if (!runtime)
          return {
            label: account.label,
            socket: account.socket,
            state: "unavailable",
            error: "RUNTIME_UNAVAILABLE",
          };
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
            socket: account.socket,
            state: probe.state,
            version: probe.runtimeVersion,
            directDelivery: capabilities.directDelivery === true,
            threadsSampled: Array.isArray(sessions) ? sessions.length : 0,
          };
        } catch (error) {
          return {
            label: value.label,
            installationId,
            state: "unavailable",
            error: String(error),
          };
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
await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (process.exitCode !== 2) process.exitCode = 1;
});
