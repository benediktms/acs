import {
  chmodSync,
  mkdirSync,
  readFileSync,
  existsSync,
  lstatSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export function persistentEnvironment(environment: Record<string, string>, cwd = process.cwd()) {
  const normalized = { ...environment };
  for (const key of [
    "CODEX_HOME",
    "ACS_HOME",
    "ACS_CONFIG_PATH",
    "ACS_CONTROL_SOCKET",
    "ACS_STORAGE_PATH",
    "ACS_CODEX_SOCKET",
  ])
    if (normalized[key]) normalized[key] = resolve(cwd, normalized[key]);
  if (normalized.ACS_CODEX_BINARY?.includes("/"))
    normalized.ACS_CODEX_BINARY = resolve(cwd, normalized.ACS_CODEX_BINARY);
  return normalized;
}

export function launchAgent(options: {
  command: string[];
  environment: Record<string, string>;
  log: string;
}) {
  return {
    Label: "local.acs.daemon",
    ProgramArguments: [...options.command, "daemon", "run"],
    RunAtLoad: true,
    KeepAlive: true,
    ThrottleInterval: 10,
    EnvironmentVariables: options.environment,
    StandardOutPath: options.log,
    StandardErrorPath: options.log,
  };
}

export function codexAppServerLaunchAgent(options: {
  binary: string;
  home: string;
  socket: string;
  label: string;
  log: string;
}) {
  return {
    Label: `local.acs.codex-app-server.${options.label}`,
    ProgramArguments: [options.binary, "app-server", "--listen", `unix://${options.socket}`],
    EnvironmentVariables: { CODEX_HOME: options.home },
    StandardOutPath: options.log,
    StandardErrorPath: options.log,
    KeepAlive: true,
    RunAtLoad: true,
    Umask: 0o77,
    SoftResourceLimits: { NumberOfFiles: 4096 },
  };
}

export async function installCodexAppServer(options: {
  binary: string;
  home: string;
  socket: string;
  label: string;
  userHome: string;
  uid: number;
  socketOccupied?: () => Promise<boolean>;
  launchctl?: typeof launchctl;
}) {
  const control = options.launchctl ?? launchctl,
    domain = `gui/${options.uid}`,
    label = `local.acs.codex-app-server.${options.label}`,
    target = `${domain}/${label}`,
    path = `${options.userHome}/Library/LaunchAgents/${label}.plist`,
    log = `${options.userHome}/Library/Logs/acs-codex-${options.label}.log`,
    plist = Bun.spawnSync(["/usr/bin/plutil", "-convert", "xml1", "-o", "-", "-"], {
      stdin: Buffer.from(JSON.stringify(codexAppServerLaunchAgent({ ...options, log }))),
    });
  if (!plist.success) throw new Error(plist.stderr.toString());
  const content = plist.stdout.toString(),
    loaded = control(["print", target]).success;
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dirname(log), { recursive: true });
  mkdirSync(dirname(options.socket), { recursive: true, mode: 0o700 });
  if (!loaded && options.socketOccupied && (await options.socketOccupied()))
    throw new Error(
      `Codex app-server socket is already in use; run acs codex app-server adopt ${options.label}`,
    );
  const changed = !existsSync(path) || readFileSync(path, "utf8") !== content;
  if (loaded && changed) requireSuccess(control(["bootout", target]));
  if (changed) writeFileSync(path, content, { mode: 0o600 });
  if (!loaded || changed) requireSuccess(control(["bootstrap", domain, path]));
}

export function removeCodexAppServers(options: {
  labels: readonly string[];
  userHome: string;
  uid: number;
  launchctl?: typeof launchctl;
}) {
  const control = options.launchctl ?? launchctl,
    directory = `${options.userHome}/Library/LaunchAgents/`,
    prefix = "local.acs.codex-app-server.";
  if (!existsSync(directory)) return;
  for (const file of readdirSync(directory)) {
    if (!file.startsWith(prefix) || !file.endsWith(".plist")) continue;
    const label = file.slice(prefix.length, -".plist".length);
    if (options.labels.includes(label)) continue;
    const target = `gui/${options.uid}/${prefix}${label}`;
    if (control(["print", target]).success) requireSuccess(control(["bootout", target]));
    rmSync(`${directory}${file}`, { force: true });
  }
}

export function restartCodexAppServer(options: {
  label: string;
  uid: number;
  launchctl?: typeof launchctl;
}) {
  const control = options.launchctl ?? launchctl;
  requireSuccess(
    control(["kickstart", "-k", `gui/${options.uid}/local.acs.codex-app-server.${options.label}`]),
  );
}

export function ownedCodexAppServerPid(
  home: string,
  socket: string,
  inspect = { listenerPid, processDetails },
) {
  const pid = inspect.listenerPid(socket);
  if (!pid) return undefined;
  const details = inspect.processDetails(pid);
  if (
    basename(details.executable) !== "codex" ||
    !environmentHas(details.environment, "CODEX_HOME", home)
  )
    throw new Error("CODEX_APP_SERVER_OWNERSHIP_UNVERIFIED");
  return pid;
}

function shellQuote(value: string) {
  if (!value.includes("'")) return `'${value}'`;
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function swarmLauncher(command: readonly string[], codexBinary = "codex") {
  return `#!/bin/sh\n# acs-swarm-launcher\nset -eu\nulimit -n 4096 > /dev/null 2>&1 || true\nfor argument in "$@"; do\n  case "$argument" in\n    --) break ;;\n    --remote|--remote=*) printf '%s\\n' 'ACS: swarm owns --remote; remove it and retry' >&2; exit 2 ;;\n  esac\ndone\nhas_cwd=false\nskip_value=false\nfor argument in "$@"; do\n  if $skip_value; then\n    skip_value=false\n    continue\n  fi\n  case "$argument" in\n    --) break ;;\n    -C|--cd) has_cwd=true; skip_value=true ;;\n    -C?*|--cd=*) has_cwd=true ;;\n    -c|-i|-m|-p|-s|-a|--config|--image|--model|--profile|--sandbox|--ask-for-approval|--add-dir|--enable|--disable|--local-provider|--remote-auth-token-env) skip_value=true ;;\n    -*) ;;\n    exec|e|review|login|logout|mcp|plugin|mcp-server|app-server|remote-control|app|completion|update|doctor|sandbox|debug|apply|a|queue|archive|delete|migrate-rollouts|unarchive|cloud|exec-server|features|help|agents) printf '%s\\n' "ACS: swarm only starts interactive sessions; use codex $argument" >&2; exit 2 ;;\n    *) break ;;\n  esac\ndone\nhome="\${CODEX_HOME:-$HOME/.codex}"\nsocket=$(CODEX_HOME="$home" ${shellQuote(command.join(" "))} codex socket 2>/dev/null) || { printf '%s\\n' 'ACS: configure CODEX_HOME for a managed account, then run acs init' >&2; exit 2; }\nif [ ! -S "$socket" ]; then\n  printf '%s\\n' 'ACS: managed Codex app-server is unavailable; run acs init or acs codex app-server restart <account-label>' >&2\n  exit 2\nfi\nif $has_cwd; then\n  exec ${shellQuote(codexBinary)} --dangerously-bypass-hook-trust --remote "unix://$socket" "$@"\nfi\nexec ${shellQuote(codexBinary)} --dangerously-bypass-hook-trust --remote "unix://$socket" --cd "$PWD" "$@"\n`;
}

function swarmLauncherOwnership(path: string) {
  const details = lstatSync(path, { throwIfNoEntry: false });
  if (!details) return undefined;
  return (
    details.isFile() && readFileSync(path, "utf8").startsWith("#!/bin/sh\n# acs-swarm-launcher\n")
  );
}

function removeCodexZshIntegration(home: string) {
  const path = `${home}/.zshrc.d/acs-codex.zsh`,
    zshrc = `${home}/.zshrc`,
    source = `\n# acs-codex-routing\nsource "${path}"\n`;
  rmSync(path, { force: true });
  if (existsSync(zshrc)) writeFileSync(zshrc, readFileSync(zshrc, "utf8").replace(source, "\n"));
}

export function removeLegacySwarmLauncher(home: string) {
  const path = `${home}/.local/bin/swarm`;
  if (swarmLauncherOwnership(path)) rmSync(path);
  removeCodexZshIntegration(home);
}

export function syncSwarmLauncher(options: {
  enabled: boolean;
  accountCount: number;
  home: string;
  command: readonly string[];
  codexBinary: string;
}) {
  const path = `${options.home}/.local/bin/swarm`,
    owned = swarmLauncherOwnership(path);
  if (options.enabled && options.accountCount && owned === false)
    throw new Error(`ACS_SWARM_LAUNCHER_COLLISION: ${path}`);
  removeCodexZshIntegration(options.home);
  if (options.enabled && options.accountCount) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, swarmLauncher(options.command, options.codexBinary), { mode: 0o755 });
    chmodSync(path, 0o755);
  } else if (owned) rmSync(path);
}

export function listenerPidCommand(socket: string) {
  return ["/usr/sbin/lsof", "-nP", "-t", "-a", "-U", socket];
}

function listenerPid(socket: string) {
  const value = Bun.spawnSync(listenerPidCommand(socket)).stdout.toString().trim();
  return /^\d+$/.test(value) ? Number(value) : undefined;
}

function processDetails(pid: number) {
  const args = ["-p", String(pid), "-o", "command="],
    command = Bun.spawnSync(["/bin/ps", "ww", ...args])
      .stdout.toString()
      .trim(),
    withEnvironment = Bun.spawnSync(["/bin/ps", "eww", ...args])
      .stdout.toString()
      .trim();
  return {
    executable: Bun.spawnSync(["/bin/ps", "-p", String(pid), "-o", "comm="])
      .stdout.toString()
      .trim(),
    environment: withEnvironment.startsWith(command)
      ? withEnvironment.slice(command.length).trim()
      : "",
  };
}

function environmentHas(environment: string, name: string, value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^| )${name}=${escaped}(?= [A-Za-z_][A-Za-z0-9_]*=|$)`).test(environment);
}

export async function installService(options: {
  command: string[];
  environment: Record<string, string>;
  home: string;
  uid: number;
  stopUnmanagedDaemon: () => Promise<void>;
  launchctl?: typeof launchctl;
}) {
  const control = options.launchctl ?? launchctl,
    path = `${options.home}/Library/LaunchAgents/local.acs.daemon.plist`,
    log = `${options.home}/Library/Logs/acs.log`,
    domain = `gui/${options.uid}`,
    target = `${domain}/local.acs.daemon`,
    plist = Bun.spawnSync(["/usr/bin/plutil", "-convert", "xml1", "-o", "-", "-"], {
      stdin: Buffer.from(JSON.stringify(launchAgent({ ...options, log }))),
    });
  if (!plist.success) throw new Error(plist.stderr.toString());
  const content = plist.stdout.toString(),
    changed = !existsSync(path) || readFileSync(path, "utf8") !== content,
    loaded = control(["print", target]).success;
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dirname(log), { recursive: true });
  const legacyTarget = `${domain}/local.asc.daemon`;
  if (control(["print", legacyTarget]).success) requireSuccess(control(["bootout", legacyTarget]));
  rmSync(`${options.home}/Library/LaunchAgents/local.asc.daemon.plist`, { force: true });
  if (!loaded) await options.stopUnmanagedDaemon();
  if (changed) writeFileSync(path, content, { mode: 0o600 });
  if (loaded && changed) requireSuccess(control(["bootout", target]));
  if (!loaded || changed) {
    for (let attempt = 0; ; attempt++) {
      const result = control(["bootstrap", domain, path]);
      if (result.success) break;
      if (!loaded || !changed || attempt === 49)
        throw new Error(result.error || "Service bootstrap failed");
      await Bun.sleep(100);
    }
  } else requireSuccess(control(["kickstart", "-k", target]));
}

type DaemonLifecycleOptions = {
  home: string;
  uid: number;
  launchctl?: typeof launchctl;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type DaemonControlPaths = { runtime: string; token: string };

export function daemonControlPathsFromEnvironment(environment: unknown): DaemonControlPaths {
  if (!isRecord(environment)) throw new Error("Invalid ACS LaunchAgent EnvironmentVariables");
  const runtime = absolutePath(environment.ACS_CONTROL_SOCKET, "ACS_CONTROL_SOCKET"),
    dataDirectory =
      environment.ACS_HOME === undefined
        ? `${absolutePath(environment.HOME, "HOME")}/Library/Application Support/acs`
        : absolutePath(environment.ACS_HOME, "ACS_HOME");
  return { runtime, token: `${dataDirectory}/control.token` };
}

export function installedDaemonControlPaths(
  home: string,
  fallback: DaemonControlPaths,
): DaemonControlPaths {
  const path = `${home}/Library/LaunchAgents/local.acs.daemon.plist`;
  if (!existsSync(path)) return fallback;
  const plist = Bun.spawnSync(["/usr/bin/plutil", "-convert", "json", "-o", "-", path]);
  if (!plist.success) throw new Error(plist.stderr.toString() || "Invalid ACS LaunchAgent plist");
  const root: unknown = JSON.parse(plist.stdout.toString());
  if (!isRecord(root)) throw new Error("Invalid ACS LaunchAgent plist");
  return daemonControlPathsFromEnvironment(root.EnvironmentVariables);
}

export function daemonCommandRunsForeground(
  command: string | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform,
) {
  return (
    command === "run" ||
    (platform === "darwin" &&
      command === "start" &&
      environment.XPC_SERVICE_NAME === "local.acs.daemon")
  );
}

export function daemonCommandWaitsForHandover(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return environment.XPC_SERVICE_NAME === "local.acs.daemon";
}

export async function stopUnmanagedDaemon(
  isSocketOccupied: () => Promise<boolean>,
  shutdown: () => Promise<unknown>,
) {
  if (!(await isSocketOccupied())) return;
  try {
    await shutdown();
  } catch (error) {
    if (await isSocketOccupied()) throw error;
  }
}

export type DaemonServiceStatus = {
  state: "control-ready" | "stopped" | "supervisor-running/control-unavailable";
  exitCode: 0 | 1 | 2;
};

function daemonService(options: Pick<DaemonLifecycleOptions, "home" | "uid">) {
  const domain = `gui/${options.uid}`,
    label = "local.acs.daemon";
  return {
    domain,
    target: `${domain}/${label}`,
    path: `${options.home}/Library/LaunchAgents/${label}.plist`,
  };
}

export async function startDaemonService(
  options: DaemonLifecycleOptions & {
    isSocketOccupied?: () => Promise<boolean>;
    waitUntilReady: () => Promise<void>;
  },
) {
  const control = options.launchctl ?? launchctl,
    service = daemonService(options);
  if (!control(["print", service.target]).success) {
    if (options.isSocketOccupied && (await options.isSocketOccupied()))
      throw new Error(
        "ACS daemon is already running; stop the unmanaged daemon before starting the service",
      );
    if (!existsSync(service.path))
      throw new Error(`ACS LaunchAgent is not installed: ${service.path}`);
    requireSuccess(control(["bootstrap", service.domain, service.path]));
  }
  await options.waitUntilReady();
  return service.target;
}

export async function stopDaemonService(
  options: DaemonLifecycleOptions & {
    isControlReady: () => Promise<boolean>;
    stopUnmanagedDaemon: () => Promise<void>;
    waitUntilStopped: () => Promise<void>;
  },
) {
  const control = options.launchctl ?? launchctl,
    service = daemonService(options),
    loaded = control(["print", service.target]).success;
  if (loaded) {
    const result = control(["bootout", service.target]);
    if (!result.success && control(["print", service.target]).success) requireSuccess(result);
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!control(["print", service.target]).success) break;
      if (attempt === 49) throw new Error("ACS service did not unload");
      await (options.sleep ?? Bun.sleep)(100);
    }
    if (await options.isControlReady()) await options.stopUnmanagedDaemon();
  } else await options.stopUnmanagedDaemon();
  await options.waitUntilStopped();
}

export async function daemonServiceStatus(
  options: DaemonLifecycleOptions & { isControlReady: () => Promise<boolean> },
): Promise<DaemonServiceStatus> {
  const control = options.launchctl ?? launchctl,
    loaded = control(["print", daemonService(options).target]).success;
  if (await options.isControlReady()) return { state: "control-ready", exitCode: 0 };
  return loaded
    ? { state: "supervisor-running/control-unavailable", exitCode: 2 }
    : { state: "stopped", exitCode: 1 };
}

export async function restartDaemonService(
  options: DaemonLifecycleOptions & {
    isControlReady: () => Promise<boolean>;
    stopUnmanagedDaemon: () => Promise<void>;
    waitUntilStopped: () => Promise<void>;
    waitUntilReady: () => Promise<void>;
  },
) {
  await stopDaemonService(options);
  return startDaemonService(options);
}

function launchctl(args: string[]) {
  const result = Bun.spawnSync(["/bin/launchctl", ...args]);
  return { success: result.success, error: result.stderr.toString() };
}

function requireSuccess(result: ReturnType<typeof launchctl>) {
  if (!result.success) throw new Error(result.error || "launchctl failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absolutePath(value: unknown, name: string) {
  if (typeof value !== "string" || !isAbsolute(value))
    throw new Error(`Invalid ACS LaunchAgent ${name}`);
  return value;
}
