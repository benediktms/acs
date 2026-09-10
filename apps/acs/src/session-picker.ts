export interface SessionChoice {
  readonly session: { readonly installationId: string; readonly opaqueId: string };
  readonly runtimeState: string;
  readonly title?: string;
  readonly cwd?: string;
}

export function sessionChoices(value: unknown): SessionChoice[] {
  if (!Array.isArray(value)) throw new Error("Invalid runtime session list");
  return value.map((item) => {
    const snapshot = record(item),
      session = record(snapshot.session),
      attributes = record(snapshot.attributes);
    if (
      typeof session.installationId !== "string" ||
      typeof session.opaqueId !== "string" ||
      typeof snapshot.runtimeState !== "string"
    )
      throw new Error("Invalid runtime session");
    return {
      session: { installationId: session.installationId, opaqueId: session.opaqueId },
      runtimeState: snapshot.runtimeState,
      title: typeof attributes.displayTitle === "string" ? attributes.displayTitle : undefined,
      cwd: typeof attributes.cwdHint === "string" ? attributes.cwdHint : undefined,
    };
  });
}

export async function pickSession(
  sessions: readonly SessionChoice[],
  ask: (prompt: string) => Promise<string>,
) {
  if (!sessions.length) throw new Error("No Codex sessions found");
  const choices = sessions
      .map(
        (session, index) =>
          `${index + 1}) ${session.title ?? "Untitled session"} [${session.runtimeState}]${session.cwd ? ` ${session.cwd}` : ""}`,
      )
      .join("\n"),
    answer = (await ask(`${choices}\nSelect a Codex session [1-${sessions.length}]: `)).trim();
  if (!/^\d+$/.test(answer)) throw new Error("Invalid session selection");
  const choice = Number(answer);
  if (choice < 1) throw new Error("Invalid session selection");
  const selected = sessions.at(choice - 1);
  if (!selected) throw new Error("Invalid session selection");
  return selected.session;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid runtime session");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
