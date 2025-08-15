## Web Stores, CI/CD, Review

### ✅ Chrome Web Store

- **Unlisted publishing is supported**
  - Requires one-time $5 developer registration
  - Full review process applies even for unlisted
  - Share via direct link, not discoverable by search
- **Updates**
  - Upload new ZIP + bump `manifest.json` version
  - Auto-rollout to users after approval (typically fast)
- **CI/CD**
  - Supported via Web Store API + tools like `chrome-webstore-upload-cli`
- **Privacy**
  - Privacy policy **required** if handling user data (even if local only)
  - Host a minimal static policy (e.g. GitHub Pages)

### ✅ Firefox Add-ons (AMO)

- **Unlisted (self-distributed) publishing is supported**
  - Upload `.xpi` → signed → direct download link
  - No review delay, ideal for testing
- **Updates**
  - Upload new `.xpi` with bumped version
  - Fast turnaround, same download link
- **CI/CD**
  - Official `web-ext` tool supports build + sign + publish
- **Privacy**
  - Same as Chrome: minimal policy required for local data

### ⛔ Safari - Not worth it atm

### Permissions & Review Risk

- Declaring `["storage", "webNavigation", "tabs", "idle"]` can slow reviews
- To reduce friction:
  - Use `optional_host_permissions` if possible
  - Provide a clear reviewer note justifying each permission
  - Avoid sensitive language (e.g., "tracking") in manifest/comments

### SEO

- Make sure to do a deep talk with your favorit LLM before posting to app store - might be things with desc n SEO that is important
