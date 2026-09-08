import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
    ProgramArguments: [...options.command, "daemon", "start"],
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

export function codexZshIntegration(command: readonly string[]) {
  return `# acs-codex-routing\ncodex() {\n  local -a acs_bin=(${command.map(shellQuote).join(" ")})\n  local acs_home="\${ACS_HOME:-$HOME/Library/Application Support/acs}" config="\${ACS_CONFIG_PATH:-$acs_home/config.toml}"\n  if [[ " $* " == *" --acs-standalone "* ]]; then\n    print -u2 -- "ACS: standalone Codex is unavailable for direct delivery"\n    command codex "\${(@)@:#--acs-standalone}"; return\n  fi\n  if [[ " $* " == *" --remote "* ]]; then print -u2 -- "ACS: --remote requires --acs-standalone"; return 2; fi\n  case "$1" in ""|agents|resume|fork|queue|archive|delete|unarchive)\n    local home="\${CODEX_HOME:-$HOME/.codex}" socket\n    socket=$(CODEX_HOME="$home" "\${acs_bin[@]}" codex socket 2>/dev/null) || { print -u2 -- "ACS: configure CODEX_HOME in $config or use --acs-standalone"; return 2; }\n    command codex --app-server-url "unix://$socket" "$@";;\n  *) command codex "$@";; esac\n}\n`;
}

export function installCodexZshIntegration(home: string, command: readonly string[]) {
  const directory = `${home}/.zshrc.d`,
    path = `${directory}/acs-codex.zsh`,
    zshrc = `${home}/.zshrc`,
    source = `\n# acs-codex-routing\nsource "${path}"\n`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path, codexZshIntegration(command), { mode: 0o600 });
  const current = existsSync(zshrc) ? readFileSync(zshrc, "utf8") : "";
  if (!current.includes(`source "${path}"`))
    writeFileSync(zshrc, current + source, { mode: 0o600 });
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
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

function launchctl(args: string[]) {
  const result = Bun.spawnSync(["/bin/launchctl", ...args]);
  return { success: result.success, error: result.stderr.toString() };
}

function requireSuccess(result: ReturnType<typeof launchctl>) {
  if (!result.success) throw new Error(result.error || "launchctl failed");
}
