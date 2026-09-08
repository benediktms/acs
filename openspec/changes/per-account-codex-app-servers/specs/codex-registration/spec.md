## MODIFIED Requirements

### Requirement: Host-attested caller identity

The MCP bridge SHALL select the Codex installation from the host process `CODEX_HOME` and then derive the caller session exclusively from supported Codex-owned metadata. It SHALL reject an unconfigured home and SHALL never accept model-supplied account routing.

#### Scenario: Unconfigured caller home

- **WHEN** the MCP bridge is invoked with a `CODEX_HOME` that is not configured
- **THEN** identity-dependent operations fail without attaching the caller to another account

#### Scenario: Missing or ambiguous metadata

- **WHEN** caller evidence is missing, malformed, ambiguous, or unsupported
- **THEN** identity-dependent operations fail with `UNATTESTED_CALLER`
