# Code Review Rubric

Work is evaluated on **four axes only**: Code Quality & Robustness, Error Handling,
Tests, and Observability. Score each axis on its own merits.

**System size is NOT a criterion.** Scope, lines of code, number of features,
endpoints, tables, or subsystems do not earn credit. A small, well-built system
scores higher than a large, fragile one. Do not reward breadth or penalize
smallness — judge only how well the code that exists meets the four axes below.

## Code Quality & Robustness
- No function longer than ~50 lines without a clear reason
- No duplicated logic across 3+ places — extract to shared function
- No magic numbers/strings — named constants
- No commented-out code left in
- Null/undefined checks on any value from external input, API response, or optional field

## Error Handling
- Every external call (API, DB, filesystem, network) wrapped in try/catch
- Errors are typed/classified (not generic `catch (e)` swallowed silently)
- User-facing errors are distinct from internal errors (no leaking stack traces to users)
- Every catch block either logs, rethrows, or recovers — never empty
- Async functions have rejection handling; no unhandled promise rejections

## Tests
- Every public function/exported module has at least one unit test
- Every bug fix includes a regression test
- Critical paths (auth, payments, data writes) have integration tests
- Tests cover at least one failure/edge case per function, not just the happy path

## Observability
- Every service/module logs at entry/exit of key operations (structured, not console.log strings)
- Every external call logs latency and success/failure
- Errors are logged with enough context to reproduce (input params, not just "failed")
- Critical operations emit a metric (count, duration, or error rate)

## Severity
- P0: missing error handling on critical path, no tests on critical path — fix immediately
- P1: missing error handling elsewhere, thin test coverage — fix this cycle
- P2: style/quality nits, nice-to-have observability — backlog