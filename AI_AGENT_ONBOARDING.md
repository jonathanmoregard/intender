# AI Agent Onboarding Guide

### Welcome

Intender is a Chrome extension that enables intention-based browsing. The user configures a list of websites and intentions for each - navigating to a website in the list opens an intention page, where the user gets to reaffirm their intention by typing it into an input box, before proceeding to the site. Example: "I am not visiting reddit due to habit, I'm entering with a goal in mind."

## Repository Layout (high-signal)

Go through these files/folders one by one and load them into context:

- `entrypoints/background.ts`: Service worker (inactivity, scope detection, redirects, focus handling)
- `entrypoints/intention-page/`: Intention page
- `entrypoints/settings/`: UI and settings, list of site/intention pairs, inactivity settings, and typo allowance.
- `components/`: Pure helpers (URL normalization, time, storage, fuzzy matching, intention types)
- `tests-e2e/`: Playwright tests and utilities
- `tests/`: Vitest unit tests

## Testing & Execution

Read this text for future reference:

### Commands

- Dev/build
  - `npm run dev` (WXT dev server)
  - `npm run build` (production build)
  - `npm run compile` (tsc typecheck)

- Unit tests (Vitest)
  - `npm test` or `npm run test:watch`

- E2E (Playwright projects)
  - `npm run test:e2e` → runs `e2e-parallel` then `e2e-serial` with reporter
  - `npm run test:e2e:parallel` → only parallel‑safe tests
  - `npm run test:e2e:serial` → only serial tests
  - `npm run test:e2e:robustness-check` → 5x repeats for both projects (useful to detect flakiness)

### Logging (Service Worker tee)

Location: `tests-e2e/utils/extension.ts`

- Enable via env: `TEST_SW_LOG=true` (disabled by default)
- Automatic cleanup of logs older than 2 days
- Service worker console is intercepted and teed into the per‑test file
- Use with robustness checks to capture intermittent failures:
  - `TEST_SW_LOG=true npm run test:e2e:robustness-check`

### Traces and artifacts

- Playwright stores per‑test traces/screenshots under `.test-results/`
- Note: explore these programattically, do not use `npx playwright show-trace`. Show-trace is human-optimized, not good for agents.

## PR Creation Process

0. **COMMIT CHANGES** check uncommited changes, read them, create a commit with an appropriate message. Keep `pnpm-lock.yaml` in sync; CI uses a frozen lockfile.
1. **Analyze changes**: start with updating master, and then running `git diff origin/master HEAD` and run commands until you have a clear idea of the changes
2. **Create branch summary**: writes succinct title + paragraph summary in chat window
3. **Check version**: `npm run version:check`
4. **Suggest version bump**: AI analyzes changes and suggests semantic version
5. **Approve version**: User confirms AI's version suggestion
6. **Update version**: Use the `package.json` version field - it's our single source of truth
7. **Create PR**: `gh pr create --fill --base master --head <insert branch name> --title "<insert title>" --body "<insert description, less than 1000 chars (as short/clear as possible)>" | cat
8. **Output link**: AI provides clickable PR link in chat (e.g., **[https://github.com/jonathanmoregard/intender/pull/48](https://github.com/jonathanmoregard/intender/pull/48)**)

### Lockfile and CI

CI runs with a frozen lockfile. If `pnpm install --frozen-lockfile` fails due to a specifier mismatch between `package.json` and `pnpm-lock.yaml`, update the lockfile before opening a PR:

- Recommended (no install):
  - `pnpm install --lockfile-only`
  - Commit `pnpm-lock.yaml`
- Or install (regenerates lockfile):
  - `pnpm install --no-frozen-lockfile`
  - Commit `pnpm-lock.yaml`

Always re-run tests locally after lockfile updates, then push and (re)create the PR.

## Code Standard

This document captures our team’s preferences and conventions. It is intentionally concise and high‑signal.

### 1. Language & Types

1. TypeScript everywhere; enable `strictNullChecks: true` and keep it green.
2. Prefer parsing over validation: return stronger types/ADTs (e.g., branded types, discriminated unions) instead of booleans.
3. Avoid weak booleans for multi‑state logic; use richer types.
4. No default parameter values; pass all parameters explicitly.
5. Do not use `any`/`ts-ignore` unless there is a tracked reason; prefer typed helpers.

### 2. Architecture & State

1. Favor Elm/Redux‑style architecture (clear data flow, explicit updates, pure reducers, command effects).
2. Prefer functional style and immutability; use pure functions and avoid shared mutable state.
3. Co‑locate data types and their helpers in the same file (keeps usage discoverable).
4. Small, composable modules; avoid deep abstractions unless they pay for themselves.

### 3. UI & Styling

1. Do not put styles in TypeScript; use CSS (or CSS modules) for styling.
2. Keep components simple and focused; lift state up only when needed.
3. Use stable selectors (`data-testid`) for tests; avoid brittle text/class selectors.

### 4. Naming & Refactors

1. Names must reflect current usage; when behavior/usage changes, update names.
2. When renaming a concept, keep edits minimal and surgical; follow up with a short list of suggested cleanup tasks.

### 5. Errors, Logging & Observability

1. Add log statements to diagnose issues before introducing complex fixes.
2. Fail fast with typed errors or `Result`‑like types; surface context that helps debugging.
3. Avoid noisy logs in hot paths; prefer structured, concise messages.

### 6. Testing

1. Keep tests easy to oversee; focus on the most important cases for maximum impact.
2. Prefer industry‑standard, simple, professional setups (unit via Vitest; E2E via Playwright).
3. Use deterministic tests with stable selectors (`data-testid`); avoid arbitrary sleeps.
4. For E2E: share helpers/utilities; avoid duplication. Keep flows short and readable.

### 7. Dependencies & Versions

1. `package.json` is the single source of truth for versions.
2. Keep `pnpm-lock.yaml` in sync; CI uses a frozen lockfile.
3. Prefer smallest set of dependencies; remove unused ones promptly.

### 8. Code Style & Comments

1. Optimize for clarity and readability; prefer straightforward code over cleverness.
2. Comment “why” not “how”; avoid stating the obvious.
3. Keep naming and comments in the same abstraction as the code's purpose, don't mention use cases in general helpers.

### 9. PRs & Process

1. Before structural changes, propose alternative options with pros/cons; let the owner choose.
2. Follow the PR Management guide in `cursor_instructions/PR_MANAGEMENT.md` (version bump, lockfile sync, etc.).

### 10. Documentation

1. Keep README and docs succinct and practical.

### 11. Security & Permissions (Extensions)

1. Request the minimum necessary permissions; prefer domain‑scoped or dynamic injection over `<all_urls>`.
2. Avoid collecting sensitive data; keep tracking strictly local and minimal.
3. Secure code is easier when code is simple, low abstraction, low nesting etc. Keep the code enjoyable to read, simple, understandable.

### 12. Performance

1. Prefer O(1)/O(n) approaches and avoid unnecessary allocations in hot paths.
2. Measure before optimizing; back changes with metrics or profiling when relevant.

These standards reflect how we write code daily: functional, typed, simple, and intentional.
