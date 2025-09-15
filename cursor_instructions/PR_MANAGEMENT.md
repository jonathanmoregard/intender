# PR Management Guide for Cursor AI

## PR Creation Process

0. **COMMIT CHANGES** check uncommited changes, read them, create a commit with an appropriate message. Keep `pnpm-lock.yaml` in sync; CI uses a frozen lockfile.
1. **Analyze changes**: start with updating master, and then running `git diff origin/master HEAD` and run commands until you have a clear idea of the changes
2. **Create branch summary**: writes succinct title + paragraph summary in chat window
3. **Check version**: `npm run version:check`
4. **Suggest version bump**: AI analyzes changes and suggests semantic version
5. **Approve version**: User confirms AI's version suggestion
6. **Update version**: Use the `package.json` version field - it's our single source of truth
7. **Create PR**: `gh pr create --fill --base master --head <insert branch name> --title "<insert title>" --body "<insert description, less than 1000 chars (as short/clear as possible)>" | cat
8. **Output link**: AI provides clickable PR link

## Lockfile and CI

CI runs with a frozen lockfile. If `pnpm install --frozen-lockfile` fails due to a specifier mismatch between `package.json` and `pnpm-lock.yaml`, update the lockfile before opening a PR:

- Recommended (no install):
  - `pnpm install --lockfile-only`
  - Commit `pnpm-lock.yaml`
- Or install (regenerates lockfile):
  - `pnpm install --no-frozen-lockfile`
  - Commit `pnpm-lock.yaml`

Always re-run tests locally after lockfile updates, then push and (re)create the PR.
