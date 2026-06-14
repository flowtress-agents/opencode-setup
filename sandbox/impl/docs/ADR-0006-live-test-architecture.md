# ADR-0006: Live Test Architecture

## Status

**Proposed**

## Context

Live Docker, herdr, and pi integration tests cannot coexist with the existing micro-impl test structure. The current test layout under `test/sandbox/impl/` is designed around `spec/` and `fixtures/` directories that support unit and green-phase integration tests. Live tests — those that spawn real Docker containers, connect to actual herdr sockets, or invoke the real PTY stack — require a different treatment:

- **Environment isolation**: Live tests depend on Docker being available, which is not guaranteed in all CI environments or developer machines.
- **Execution speed**: Real container lifecycle management adds seconds per test, incompatible with the fast feedback loop expected from unit tests.
- **Flakiness surface**: Network, container registry, and host resource contention can cause live tests to fail for reasons unrelated to the code under test.
- **Test gate**: Live tests must be explicitly enabled via `RUN_LIVE_TESTS=1` to prevent accidental contamination of normal test runs.

Placing live tests alongside unit tests would blur the distinction between green-phase (deterministic, fast) and live-phase (integration, slow) test intent, making it harder to maintain a clear testing contract.

## Decision

Live integration tests are placed in `test/sandbox/impl/__tests__/live/`.

This decision is driven by four converging factors:

1. **`test/sandbox` is the designated worktree for sandbox-related test code.** The `test/sandbox` directory is the natural home for all sandbox-related testing artifacts, including live tests that exercise sandbox runtime behavior.

2. **`micro-impl` already has `sandbox.live.spec.ts` as the reference pattern.** The existence of `sandbox.live.spec.ts` in micro-impl demonstrates the pattern, but its location there is transitional — live tests that depend on the full sandbox runtime belong in the sandbox worktree, not in micro-impl which is scoped to unit/integration testing of green-phase code.

3. **Isolating live tests from `spec/` and `fixtures/` prevents cross-contamination.** The `__tests__/live/` directory is sibling to `spec/` and `fixtures/`, making it straightforward to exclude from normal test runs via glob patterns or workspace configuration.

4. **`RUN_LIVE_TESTS=1` is the explicit gate.** Only tests within `__tests__/live/` are gated behind this environment variable, ensuring that CI defaults and local developer runs without the flag execute only deterministic tests.

## Consequences

### Positive

- Real PTY, Docker, and herdr behavior is verified end-to-end, catching integration bugs that mocked or unit tests cannot surface.
- Clear physical separation makes it easy to run only live tests or only non-live tests in different CI lanes.
- The `test/sandbox` worktree provides a natural home that matches the runtime scope of the tests.

### Negative

- Live tests are inherently slow (seconds per test vs. milliseconds for unit tests).
- They require Docker to be available and running, which may not be the case in all environments.
- They are more susceptible to flakiness due to container startup timing, resource limits, and network conditions.

## Alternatives Considered

### Live tests in `micro-impl`

Rejected. `micro-impl` is the worktree for unit and green-phase integration tests — fast, deterministic, and independent of sandbox runtime dependencies. Placing live tests there would couple the green-phase test contract to runtime infrastructure concerns and slow down the feedback loop for day-to-day development.

### Live tests in a separate package

Rejected. Establishing a new package (e.g., `@cursor/test-sandbox-live`) would require publishing, versioning, and additional CI configuration. The added indirection outweighs the organizational benefit for what is essentially a gating mechanism already provided by `RUN_LIVE_TESTS=1`.

### Mocked tests only

Rejected. Mocked tests can verify the control flow of code that interacts with Docker, herdr, and PTY, but they cannot verify the actual behavior of those subsystems — container networking, socket communication, PTY master/slave pairing, and signal propagation all require real runtime interactions to validate correctness.
