# ACS State Machines

**Status:** Normative companion to `SPEC.md`

Application code MUST implement state transitions through dedicated domain functions. Direct SQL updates to state columns outside those functions are prohibited.

## 1. Task state machine

States:

```text
submitted
working
input-required
auth-required
completed
failed
canceled
rejected
```

Allowed transitions:

| Current | Event | Next | Guard |
|---|---|---|---|
| submitted | runtime accepted | working | delivery belongs to task |
| submitted | assignee acknowledges | working | assignee binding authorized |
| submitted | assignee requests input | input-required | assignee binding authorized |
| submitted | requester cancels before terminal | canceled | no competing terminal commit |
| submitted | validation/policy rejects after durable task creation | rejected | reason recorded |
| submitted | terminal runtime failure | failed | retry policy exhausted or explicit fail |
| working | assignee requests input | input-required | explicit executor callback |
| working | local runtime auth blocked | auth-required | local condition; not peer approval |
| working | explicit/automatic success | completed | result event committed |
| working | explicit/terminal runtime failure | failed | failure event committed |
| working | confirmed cancellation | canceled | exact owned execution or no execution |
| input-required | requester continuation | working | requester, target, task and context match |
| input-required | requester cancels | canceled | no competing terminal commit |
| input-required | deadline/terminal failure | failed | policy permits |
| auth-required | local authorization resolved | working | local authority only |
| auth-required | requester/local user cancels | canceled | no competing terminal commit |
| auth-required | terminal local failure | failed | reason recorded |

Terminal states:

```text
completed
failed
canceled
rejected
```

Rules:

- Terminal states have no outgoing transition.
- Repeating the same terminal transition with the same canonical payload is idempotent.
- A conflicting terminal transition returns `TASK_STATE_CONFLICT`.
- The first legal terminal transition committed in SQLite wins.
- Runtime/local-input events alone do not create A2A `input-required`; only explicit assignee request does.
- `auth-required` never grants a peer authority to satisfy a local permission prompt.

## 2. Binding state machine

States:

```text
pending
active
stale
revoked
```

Allowed transitions:

| Current | Event | Next |
|---|---|---|
| pending | session verified + uniqueness fences pass | active |
| pending | claim expires/operator revokes | revoked |
| active | runtime proves session unavailable/identity changed | stale |
| active | operator rebinds/revokes | revoked |
| stale | operator revokes | revoked |

A stale or revoked binding row is never reactivated. A new binding creates a new row and a larger epoch.

Invariants:

- one active binding per logical agent;
- one active binding per runtime installation/session;
- epoch monotonically increases per agent;
- a runtime mutation requires a final active-binding epoch fence;
- accepted executions keep the original binding/epoch forever.

## 3. Delivery intent state machine

States:

```text
pending
leased
attempting
deferred
accepted
acceptance-unknown
failed-terminal
canceled
superseded
```

Allowed transitions:

| Current | Event | Next | Notes |
|---|---|---|---|
| pending | scheduler lease | leased | atomic lease generation increment |
| pending | deadline/invalid target | failed-terminal | no runtime side effect |
| pending | task/operator cancellation | canceled | no runtime side effect |
| pending | replacement intent takes ownership | superseded | audited |
| leased | final binding fence passes | attempting | attempt row created |
| leased | runtime not ready/policy | deferred | lease cleared, not-before set |
| leased | lease expires before write | pending | recovery |
| leased | task canceled | canceled | only before write |
| attempting | runtime positive acknowledgement | accepted | execution ref optional |
| attempting | definitive retryable negative | deferred | backoff |
| attempting | definitive terminal negative | failed-terminal | reason recorded |
| attempting | request may have been accepted | acceptance-unknown | no blind retry |
| deferred | retry timer/runtime event | pending | scheduler re-evaluates |
| deferred | deadline | failed-terminal | reason deadline |
| deferred | task/operator cancellation | canceled | no active mutation |
| acceptance-unknown | reconciliation finds marker | accepted | recover execution where possible |
| acceptance-unknown | definitive absence + safe retry | pending | operator or automatic policy |
| acceptance-unknown | operator cancels | canceled | may not undo unknown runtime side effect |

Terminal delivery states:

```text
accepted
failed-terminal
canceled
superseded
```

`accepted` is terminal for the delivery attempt, not for the A2A task.

### 3.1 Lease recovery

- `leased` with expired lease and no flushed attempt record returns to `pending`.
- `attempting` with no recorded flush may return to `pending`.
- `attempting` with a recorded flush and no definitive outcome becomes `acceptance-unknown`.
- Recovery itself appends an audit/task event where user-visible.

## 4. Delivery attempt state

An attempt is append-only.

Lifecycle fields:

```text
created/started
request_flushed_at optional
completed_at optional
outcome optional
```

Once `outcome` is set it is immutable.

Attempt outcome:

```text
accepted
deferred
rejected
acceptance-unknown
```

A new attempt always receives a new `atm_` ID and incremented attempt number.

## 5. Runtime execution state machine

States:

```text
accepted
started
awaiting-local-input
completed
failed
interrupted
unknown
```

Allowed transitions:

| Current | Event | Next |
|---|---|---|
| accepted | runtime start observed | started |
| accepted | completion observed without start notification | completed/failed/interrupted |
| accepted | connection ambiguity | unknown |
| started | local approval/input request | awaiting-local-input |
| started | success | completed |
| started | failure | failed |
| started | confirmed interrupt | interrupted |
| started | connection ambiguity | unknown |
| awaiting-local-input | local owner resolves | started |
| awaiting-local-input | success/failure/interrupt | completed/failed/interrupted |
| awaiting-local-input | connection ambiguity | unknown |
| unknown | reconciliation proves state | any supported resolved state |

Terminal runtime execution states:

```text
completed
failed
interrupted
```

Only executions correlated to an ACS intent are stored in this table.

## 6. Cancellation state

Cancellation is an operation layered across task, delivery and execution.

### Pending/deferred delivery

Transaction:

1. mark intent canceled;
2. append cancellation event;
3. transition task canceled;
4. notify subscribers.

### Accepted/running delivery

Transaction 1:

1. set `task.cancellation_requested = true`;
2. append cancellation-requested event.

Then, outside the transaction:

1. adapter verifies exact execution ownership and binding epoch;
2. adapter issues vendor cancellation/interrupt;
3. definitive success commits task canceled;
4. definitive non-running reconciles current execution;
5. ambiguity leaves task non-terminal with cancellation requested.

A requester never receives a false guarantee that an unknown or unrelated turn was interrupted.

## 7. Context-only delivery

Context injection acceptance does not transition the task to completed.

Possible transitions after context-only acceptance:

- assignee calls acknowledge -> working or completed when `replyExpected=false`;
- assignee completes/fails/requests input explicitly;
- a future runtime capability provides positive correlation to a processing turn.

An arbitrary later human turn is not attributed to the task.

## 8. Atomic event/materialization rule

Every task state transition transaction performs:

1. read task row and state version;
2. validate actor and transition;
3. allocate next event sequence;
4. insert immutable event;
5. update materialized Task snapshot and state version;
6. create notification delivery intents;
7. commit.

A state version mismatch is retried from a fresh read or returned as a conflict; it is never overwritten.
