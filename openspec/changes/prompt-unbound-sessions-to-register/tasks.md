## 1. Repository Hook

- [x] 1.1 Add a trusted-reviewable `.codex/hooks.json` `SessionStart` hook for startup and resume that tells the model to call `acs_identity` on its first turn; verify the file parses as JSON.
- [x] 1.2 Add one focused repository-hook test that asserts the event, matcher, and first-turn identity instruction, then run only that targeted test file.
- [x] 1.3 Add an attested, idempotent `acs_register` MCP/control operation that atomically creates a uniquely named logical agent and binds the calling session without a claim code.
- [x] 1.4 Update the hook to make an unbound agent choose a name and call `acs_register` without operator interaction; strengthen and run the focused hook test.
- [x] 1.5 Update the typed MCP/control contracts and registration documentation, and add one targeted end-to-end registration check.

## 2. Verification

- [x] 2.1 Validate the OpenSpec change strictly and document the manual `/hooks` trust step needed before testing a fresh or resumed session.
- [x] 2.2 Remove the obsolete `SESSION_COMMUNICATION_TEST.md` scratch file and verify the remaining diff contains only automatic registration, its repository hook, tests, documentation, and OpenSpec artifacts.
