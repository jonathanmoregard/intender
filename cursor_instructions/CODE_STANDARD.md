# Code Standard

This document captures our team’s preferences and conventions. It is intentionally concise and high‑signal.

## 1. Language & Types

1. TypeScript everywhere; enable `strictNullChecks: true` and keep it green.
2. Prefer parsing over validation: return stronger types/ADTs (e.g., branded types, discriminated unions) instead of booleans.
3. Avoid weak booleans for multi‑state logic; use richer types.
4. No default parameter values; pass all parameters explicitly.
5. Do not use `any`/`ts-ignore` unless there is a tracked reason; prefer typed helpers.

## 2. Architecture & State

1. Favor Elm/Redux‑style architecture (clear data flow, explicit updates, pure reducers, command effects).
2. Prefer functional style and immutability; use pure functions and avoid shared mutable state.
3. Co‑locate data types and their helpers in the same file (keeps usage discoverable).
4. Small, composable modules; avoid deep abstractions unless they pay for themselves.

## 3. UI & Styling

1. Do not put styles in TypeScript; use CSS (or CSS modules) for styling.
2. Keep components simple and focused; lift state up only when needed.
3. Use stable selectors (`data-testid`) for tests; avoid brittle text/class selectors.

## 4. Naming & Refactors

1. Names must reflect current usage; when behavior/usage changes, update names.
2. When renaming a concept, keep edits minimal and surgical; follow up with a short list of suggested cleanup tasks.

## 5. Errors, Logging & Observability

1. Add log statements to diagnose issues before introducing complex fixes.
2. Fail fast with typed errors or `Result`‑like types; surface context that helps debugging.
3. Avoid noisy logs in hot paths; prefer structured, concise messages.

## 6. Testing

1. Keep tests easy to oversee; focus on the most important cases for maximum impact.
2. Prefer industry‑standard, simple, professional setups (unit via Vitest; E2E via Playwright).
3. Use deterministic tests with stable selectors (`data-testid`); avoid arbitrary sleeps.
4. For E2E: share helpers/utilities; avoid duplication. Keep flows short and readable.

## 7. Dependencies & Versions

1. `package.json` is the single source of truth for versions.
2. Keep `pnpm-lock.yaml` in sync; CI uses a frozen lockfile.
3. Prefer smallest set of dependencies; remove unused ones promptly.

## 8. Code Style & Comments

1. Optimize for clarity and readability; prefer straightforward code over cleverness.
2. Comment “why” not “how”; avoid stating the obvious.
3. Avoid TODOs when possible—implement or file an issue.

## 9. PRs & Process

1. Before structural changes, propose alternative options with pros/cons; let the owner choose.
2. Keep PRs small and focused; provide a succinct title and short description.
3. Follow the PR Management guide in `cursor_instructions/PR_MANAGEMENT.md` (version bump, lockfile sync, etc.).

## 10. Documentation

1. Keep README and docs succinct and practical.
2. When writing READMEs, include appreciation to Cursor and note that it was used in development.

## 11. Security & Permissions (Extensions)

1. Request the minimum necessary permissions; prefer domain‑scoped or dynamic injection over `<all_urls>`.
2. Avoid collecting sensitive data; keep tracking strictly local and minimal.

## 12. Performance

1. Prefer O(1)/O(n) approaches and avoid unnecessary allocations in hot paths.
2. Measure before optimizing; back changes with metrics or profiling when relevant.

These standards reflect how we write code daily: functional, typed, simple, and intentional.
