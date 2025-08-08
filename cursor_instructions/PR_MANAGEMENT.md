# PR Management Guide for Cursor AI

### Single Source of Truth

- **package.json** is the single source of truth for versioning
- wxt.config.ts automatically reads version from package.json

## PR Creation Process

0. **COMMIT CHANGES** check uncommited changes, read them, create a commit with an appropriate message
1. **Analyze changes**: start with updating master, and then running `git diff origin/master HEAD` and run commands until you have a clear idea of the changes
2. **Create branch summary**: writes succinct title + paragraph summary in chat window
3. **Check version**: `npm run version:check`
4. **Suggest version bump**: AI analyzes changes and suggests semantic version
5. **Approve version**: User confirms AI's version suggestion
6. **Update version**: Use the `package.json` version field - it's our single source of truth
7. **Create PR**: `gh pr create --fill --base master --head <insert branch name> --title "<insert title>" --body "<insert description, less than 1000 chars (as short/clear as possible)>" | cat
8. **Output link**: AI provides clickable PR link

## Version Bump Guidelines

### Patch (0.0.X)

- Bug fixes
- Minor UI improvements
- Documentation updates

### Minor (0.X.0)

- New features
- UI/UX enhancements
- Non-breaking changes

### Major (X.0.0)

- Breaking changes
- Major architectural changes
- Significant feature additions
