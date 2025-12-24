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
- `cursor_instructions/`: Owner preferences for code, PRs, and process. Take

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
