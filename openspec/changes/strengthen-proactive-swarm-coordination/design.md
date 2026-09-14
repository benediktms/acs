## Context

See `proposal.md` for motivation. ACS currently materializes one short `acs-swarm` skill and injects a SessionStart registration hook from strings in `apps/acs/src/service.ts`. The hook resolves identity and registration but does not inspect peers; the skill discourages routine inbox polling and permits proactive coordination without defining when to inspect active agents, share a finding, or handle a newly identified managed-worker opportunity.

## Goals / Non-Goals

**Goals:**

- Make proactive discovery and useful peer updates the normal coordination behavior.
- Give each started, resumed, or cleared managed session one current active-agent snapshot before it handles the user request.
- Preserve user authority over persistent worker creation.
- Keep the generated skill concise enough to be loaded into every managed Codex session.

**Non-Goals:**

- Add automatic polling, new MCP tools, or a scheduler.
- Let agents create persistent workers without explicit user approval.
- Change delivery, registration, or managed-worker runtime semantics.

## Decisions

1. Make `skills/acs-swarm/SKILL.md`, `skills/acs-swarm/STARTUP.md`, and `skills/acs-swarm/references/proactive-coordination.md` the repository-owned sources. Import them as Bun text assets so the compiled binary remains standalone; TypeScript owns only materialization and hook wiring.
2. Strengthen the existing skill instead of adding another skill. The behavior is part of ACS collaboration and every relevant session already receives `acs-swarm`; a second skill would duplicate routing and discovery. Put concrete conditional patterns in the linked playbook so ordinary sessions load examples only when a coordination decision arises.
3. Inject `STARTUP.md` through the existing SessionStart command rather than add another hook. It keeps the required order deterministic: `acs_identity`, conditional `acs_register`, then one `acs_agents_list`, before the user request, and points the agent at proactive coordination.
4. Let agents refresh active-agent discovery when a coordination opportunity exists and the startup snapshot is missing or stale, not on a timer or before every action. This makes discovery proactive without recreating inbox polling.
5. Require a concise proactive update when an existing peer is likely to benefit. Relevance and deduplication remain explicit gates so communication is delivery-driven rather than social chatter.
6. Treat new managed workers as local-user-owned persistent side effects. The agent first asks permission, then uses `acs codex workers create <agent>` after creation. Binding, task, and delivery receipts are asynchronous submission evidence, not readiness; the agent sends scoped work for ACS to queue until the managed session can accept it and does not poll for readiness.
7. Materialize the general playbook beside `SKILL.md` with the same private directory/file permissions and deterministic overwrite behavior. Cover existing-peer discovery and updates, closed-loop scoped delegation (`replyExpected: true` and normally `notifyOn: ["input-required", "terminal"]`), same-task input replies, uncertain-delivery recovery with stable `clientRequestId` and one `acs_task_get`, coordination-grade activity, approved managed-worker creation, blockers/dependencies, relevant post-merge notifications, shared checkout ownership, and deliberate silence.
8. Validate canonical source equality, injected startup content, and the playbook through the existing service tests and real-Codex discovery path. No runtime protocol change is needed.

## Risks / Trade-offs

- **Over-coordination from broad wording** -> Gate discovery and messaging on material benefit, relevance, and non-duplication.
- **Startup adds one discovery call per session event** -> Keep the call single-shot and reuse its result until a concrete coordination decision needs fresher state.
- **Approval mistaken for blanket authority** -> Limit approval to the proposed new worker and preserve all existing credential, network, and external-side-effect boundaries.
- **Existing sessions retain old guidance** -> Apply the change on normal skill materialization for new or reconnected sessions; do not mutate live sessions.
- **Examples become rigid ceremony** -> State decision criteria first and present examples as patterns, not mandatory steps outside their matching situation.
- **Two agents mutate one checkout while coordinating** -> Require an acknowledgement and explicit ownership/worktree split before either performs branch, stash, or move operations.
- **Uncertain delivery produces duplicate work** -> Preserve the receipt and stable request identifier, inspect the exact task once, and leave durable acceptance versus runtime delivery to ACS rather than blind resend or replacement workers.
