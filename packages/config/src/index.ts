import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export interface AcsConfig {
  daemon: {
    a2aListen: string;
    controlSocket: string;
    logLevel: "debug" | "info" | "warn" | "error";
    logFormat: "pretty" | "json";
  };
  storage: { path: string; durability: "balanced" | "strict"; busyTimeoutMs: number };
  security: {
    requireA2aAuth: boolean;
    maxRequestBytes: number;
    maxInlineContentBytes: number;
    maxParts: number;
    maxTextPartBytes: number;
    claimTtlSeconds: number;
  };
  delivery: {
    workerConcurrency: number;
    leaseSeconds: number;
    retryBaseMs: number;
    retryCapMs: number;
    maxQueuedDeliveryIntents: number;
  };
  codex: {
    enabled: boolean;
    binary: string;
    connection: "daemon";
    statusPollIntervalMs: number;
    maxInFlightRequests: number;
    accounts: CodexAccount[];
  };
}
export interface CodexAccount {
  label: string;
  home: string;
  socket: string;
}

export interface Paths {
  data: string;
  runtime: string;
  token: string;
  bridgeToken: string;
  secret: string;
}

const text = `[daemon]
a2a_listen = "127.0.0.1:7432"
control_socket = "auto"
log_level = "info"
log_format = "pretty"

[storage]
path = "auto"
durability = "balanced"
busy_timeout_ms = 5000

[security]
require_a2a_auth = true
max_request_bytes = 524288
max_inline_content_bytes = 262144
max_parts = 32
max_text_part_bytes = 65536
claim_ttl_seconds = 600

[delivery]
worker_concurrency = 16
lease_seconds = 30
retry_base_ms = 250
retry_cap_ms = 30000
max_queued_delivery_intents = 1000

[runtimes.codex]
enabled = true
codex_binary = "codex"
connection = "daemon"
status_poll_interval_ms = 2000
max_in_flight_requests = 128

[[runtimes.codex.accounts]]
label = "local"
codex_home = "auto"
`;

export function defaultLocations(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform,
  uid = process.getuid?.() ?? 0,
) {
  const home = environment.HOME ?? "",
    temporary = environment.TMPDIR ?? "/tmp";
  if (platform === "linux")
    return {
      configDirectory: `${environment.XDG_CONFIG_HOME ?? `${home}/.config`}/acs`,
      dataDirectory: `${environment.XDG_DATA_HOME ?? `${home}/.local/share`}/acs`,
      runtimeSocket: environment.XDG_RUNTIME_DIR
        ? `${environment.XDG_RUNTIME_DIR}/acs/control.sock`
        : `${temporary}/acs-${uid}/control.sock`,
    };
  const directory = `${home}/Library/Application Support/acs`;
  return {
    configDirectory: directory,
    dataDirectory: directory,
    runtimeSocket: `${temporary}/acs-${uid}/control.sock`,
  };
}

export function configPath() {
  const defaults = defaultLocations();
  return (
    process.env.ACS_CONFIG_PATH ?? `${process.env.ACS_HOME ?? defaults.configDirectory}/config.toml`
  );
}
export function writeDefaultConfig(path = configPath()) {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const home = canonicalCodexHome(process.env.CODEX_HOME ?? `${process.env.HOME ?? ""}/.codex`);
  writeFileSync(path, text.replace('codex_home = "auto"', `codex_home = ${JSON.stringify(home)}`), {
    mode: 0o600,
  });
}
export function migrateCodexAccounts(
  path = configPath(),
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (!existsSync(path)) return;
  const source = readFileSync(path, "utf8");
  const root = object(Bun.TOML.parse(source), "config"),
    runtimes = root.runtimes;
  if (isObject(runtimes) && isObject(runtimes.codex) && Object.hasOwn(runtimes.codex, "accounts")) {
    const accounts = array(runtimes.codex.accounts, "runtimes.codex.accounts");
    if (
      accounts.length !== 1 ||
      object(accounts[0], "runtimes.codex.accounts[0]").codex_home !== "auto"
    )
      return;
    const home = canonicalCodexHome(environment.CODEX_HOME ?? `${environment.HOME ?? ""}/.codex`);
    writeFileSync(
      path,
      source.replace(/codex_home\s*=\s*["']auto["']/, `codex_home = ${JSON.stringify(home)}`),
      { mode: 0o600 },
    );
    return;
  }
  const home = canonicalCodexHome(environment.CODEX_HOME ?? `${environment.HOME ?? ""}/.codex`);
  writeFileSync(
    path,
    `${source.trimEnd()}\n\n[[runtimes.codex.accounts]]\nlabel = "local"\ncodex_home = ${JSON.stringify(home)}\n`,
    { mode: 0o600 },
  );
}
export function loadConfig(path = configPath()): AcsConfig {
  const defaults = defaultLocations(),
    base = process.env.ACS_HOME ?? defaults.dataDirectory;
  const root = existsSync(path) ? object(Bun.TOML.parse(readFileSync(path, "utf8")), "config") : {};
  keys(root, ["daemon", "storage", "security", "delivery", "runtimes"], "config");
  const daemon = section(root, "daemon", [
      "a2a_listen",
      "control_socket",
      "log_level",
      "log_format",
    ]),
    storage = section(root, "storage", ["path", "durability", "busy_timeout_ms"]),
    security = section(root, "security", [
      "require_a2a_auth",
      "max_request_bytes",
      "max_inline_content_bytes",
      "max_parts",
      "max_text_part_bytes",
      "claim_ttl_seconds",
    ]),
    delivery = section(root, "delivery", [
      "worker_concurrency",
      "lease_seconds",
      "retry_base_ms",
      "retry_cap_ms",
      "max_queued_delivery_intents",
    ]),
    runtimes = section(root, "runtimes", ["codex"]),
    codex = section(runtimes, "codex", [
      "enabled",
      "codex_binary",
      "connection",
      "status_poll_interval_ms",
      "max_in_flight_requests",
      "accounts",
    ]);
  const configuredListen = string(daemon.a2a_listen, "127.0.0.1:7432"),
    listen = process.env.ACS_A2A_PORT
      ? `127.0.0.1:${positive(Number(process.env.ACS_A2A_PORT), "ACS_A2A_PORT")}`
      : configuredListen,
    controlSocket = socketPath(
      process.env.ACS_CONTROL_SOCKET ??
        auto(string(daemon.control_socket, "auto"), defaults.runtimeSocket),
    ),
    durability = string(storage.durability, "balanced"),
    connection = string(codex.connection, "daemon"),
    logLevel = process.env.ACS_LOG_LEVEL ?? string(daemon.log_level, "info"),
    logFormat = process.env.ACS_LOG_FORMAT ?? string(daemon.log_format, "pretty"),
    accounts = codexAccounts(codex.accounts, process.env, defaults.runtimeSocket);
  parseListen(listen);
  if (durability !== "balanced" && durability !== "strict")
    throw new Error("VALIDATION_FAILED: invalid storage.durability");
  if (connection !== "daemon")
    throw new Error("VALIDATION_FAILED: invalid runtimes.codex.connection");
  if (!isLogLevel(logLevel)) throw new Error("VALIDATION_FAILED: invalid daemon.log_level");
  if (logFormat !== "pretty" && logFormat !== "json")
    throw new Error("VALIDATION_FAILED: invalid daemon.log_format");
  if (!boolean(security.require_a2a_auth, true))
    throw new Error("VALIDATION_FAILED: A2A authentication is required in v1");
  return {
    daemon: {
      a2aListen: listen,
      controlSocket,
      logLevel,
      logFormat,
    },
    storage: {
      path: process.env.ACS_STORAGE_PATH ?? auto(string(storage.path, "auto"), `${base}/acs.db`),
      durability,
      busyTimeoutMs: positive(number(storage.busy_timeout_ms, 5000), "storage.busy_timeout_ms"),
    },
    security: {
      requireA2aAuth: boolean(security.require_a2a_auth, true),
      maxRequestBytes: positive(
        number(security.max_request_bytes, 524288),
        "security.max_request_bytes",
      ),
      maxInlineContentBytes: positive(
        number(security.max_inline_content_bytes, 262144),
        "security.max_inline_content_bytes",
      ),
      maxParts: positive(number(security.max_parts, 32), "security.max_parts"),
      maxTextPartBytes: positive(
        number(security.max_text_part_bytes, 65536),
        "security.max_text_part_bytes",
      ),
      claimTtlSeconds: positive(
        number(security.claim_ttl_seconds, 600),
        "security.claim_ttl_seconds",
      ),
    },
    delivery: {
      workerConcurrency: positive(
        number(delivery.worker_concurrency, 16),
        "delivery.worker_concurrency",
      ),
      leaseSeconds: positive(number(delivery.lease_seconds, 30), "delivery.lease_seconds"),
      retryBaseMs: positive(number(delivery.retry_base_ms, 250), "delivery.retry_base_ms"),
      retryCapMs: positive(number(delivery.retry_cap_ms, 30000), "delivery.retry_cap_ms"),
      maxQueuedDeliveryIntents: positive(
        number(delivery.max_queued_delivery_intents, 1000),
        "delivery.max_queued_delivery_intents",
      ),
    },
    codex: {
      enabled: boolean(codex.enabled, true),
      binary: process.env.ACS_CODEX_BINARY ?? string(codex.codex_binary, "codex"),
      connection,
      statusPollIntervalMs: positive(
        number(codex.status_poll_interval_ms, 2000),
        "runtimes.codex.status_poll_interval_ms",
      ),
      maxInFlightRequests: positive(
        number(codex.max_in_flight_requests, 128),
        "runtimes.codex.max_in_flight_requests",
      ),
      accounts,
    },
  };
}

export function codexSocket(
  home: string,
  temporary = process.env.TMPDIR ?? "/tmp",
  uid = process.getuid?.() ?? 0,
) {
  return `${temporary.replace(/\/$/, "")}/acs-${uid}/codex-${createHash("sha256").update(home).digest("hex").slice(0, 16)}.sock`;
}

function codexAccounts(
  value: unknown,
  environment: Readonly<Record<string, string | undefined>>,
  runtimeSocket: string,
): CodexAccount[] {
  const values =
    value === undefined
      ? [
          {
            label: "local",
            codex_home: environment.CODEX_HOME ?? `${environment.HOME ?? ""}/.codex`,
          },
        ]
      : array(value, "runtimes.codex.accounts");
  const temporary = dirname(dirname(runtimeSocket)),
    uid = process.getuid?.() ?? 0;
  const accounts = values.map((entry, index) => {
    const account = object(entry, `runtimes.codex.accounts[${index}]`);
    keys(account, ["label", "codex_home"], `runtimes.codex.accounts[${index}]`);
    const label = string(account.label, ""),
      rawHome = string(account.codex_home, "");
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(label))
      throw new Error(`VALIDATION_FAILED: invalid runtimes.codex.accounts[${index}].label`);
    if (!rawHome)
      throw new Error(`VALIDATION_FAILED: missing runtimes.codex.accounts[${index}].codex_home`);
    if (rawHome === "auto")
      throw new Error(
        `VALIDATION_FAILED: runtimes.codex.accounts[${index}].codex_home must be absolute`,
      );
    const home = canonicalCodexHome(rawHome);
    return {
      label,
      home,
      socket: socketPath(
        codexSocket(home, temporary, uid),
        `runtimes.codex.accounts[${index}] derived socket`,
      ),
    };
  });
  if (new Set(accounts.map((account) => account.label)).size !== accounts.length)
    throw new Error("VALIDATION_FAILED: duplicate runtimes.codex.accounts label");
  if (new Set(accounts.map((account) => account.home)).size !== accounts.length)
    throw new Error("VALIDATION_FAILED: duplicate runtimes.codex.accounts codex_home");
  return accounts;
}

export function canonicalCodexHome(path: string) {
  if (!isAbsolute(path))
    throw new Error("VALIDATION_FAILED: runtimes.codex.accounts[].codex_home must be absolute");
  let absolute = resolve(path);
  const missing: string[] = [];
  while (!existsSync(absolute)) {
    missing.unshift(basename(absolute));
    absolute = dirname(absolute);
  }
  return resolve(realpathSync(absolute), ...missing);
}

export function paths(): Paths {
  const defaults = defaultLocations(),
    base = process.env.ACS_HOME ?? defaults.dataDirectory,
    config = loadConfig();
  return {
    data:
      process.env.ACS_STORAGE_PATH ??
      (process.env.ACS_HOME ? `${base}/acs.db` : config.storage.path),
    runtime:
      process.env.ACS_CONTROL_SOCKET ??
      (process.env.ACS_HOME ? defaults.runtimeSocket : config.daemon.controlSocket),
    token: `${base}/control.token`,
    bridgeToken: `${base}/bridge.token`,
    secret: `${base}/secret.key`,
  };
}
export function parseListen(value: string) {
  const match = value.match(/^(127\.0\.0\.1|localhost):(\d+)$/) ?? value.match(/^(\[::1\]):(\d+)$/);
  if (!match) throw new Error("VALIDATION_FAILED: A2A listener must be loopback host:port");
  const host = match.at(1),
    rawPort = match.at(2);
  if (!host || !rawPort) throw new Error("VALIDATION_FAILED: invalid daemon.a2a_listen");
  return {
    hostname: host === "[::1]" ? "::1" : host,
    port: positive(Number(rawPort), "daemon.a2a_listen"),
  };
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown, name: string): ObjectValue {
  if (!isObject(value)) throw new Error(`VALIDATION_FAILED: ${name} must be a table`);
  return value;
}
function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`VALIDATION_FAILED: ${name} must be an array`);
  return value;
}
function isObject(value: unknown): value is ObjectValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function section(parent: ObjectValue, name: string, allowed: string[]) {
  const value = parent[name] === undefined ? {} : object(parent[name], name);
  keys(value, allowed, name);
  return value;
}
function keys(value: ObjectValue, allowed: string[], name: string) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`VALIDATION_FAILED: unknown ${name}.${unknown}`);
}
function string(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error("VALIDATION_FAILED: expected string");
  return value;
}
function number(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("VALIDATION_FAILED: expected number");
  return value;
}
function boolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("VALIDATION_FAILED: expected boolean");
  return value;
}
function positive(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0 || value > 1_000_000_000)
    throw new Error(`VALIDATION_FAILED: invalid ${name}`);
  return value;
}
function socketPath(value: string, name = "daemon.control_socket") {
  const maxBytes = process.platform === "linux" ? 107 : 103;
  if (Buffer.byteLength(value) > maxBytes)
    throw new Error(`VALIDATION_FAILED: ${name} exceeds ${maxBytes} bytes`);
  return value;
}
function auto(value: string, fallback: string) {
  return value === "auto" ? fallback : value;
}
function isLogLevel(value: string): value is AcsConfig["daemon"]["logLevel"] {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}
