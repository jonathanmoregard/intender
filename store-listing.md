# Chrome Web Store Listing

Copy these into the Chrome Web Store developer dashboard.

---

## Title

Intender: Mindful Browsing & Intention Setter

## Summary (132 chars max)

Sourced from `package.json` → `description` (propagated into `manifest.json` at build time). Chrome Web Store displays this field as "Summary" in the dashboard. It appears in search results and is auto-prepended to the detailed description on the listing page, so the detailed description below is written to flow from it.

Current value:

> The mindful alternative to website blockers. Set an intention before opening Twitter, TikTok, or Reddit. Reflect before you enter.

[Concatenated to...]
Description:
Ever opened a tab, blinked, and lost twenty minutes? That's autopilot browsing. Intender helps you enter with purpose.

🧭 How it works:

1. Pick the sites where you tend to drift (social media, news, YouTube, etc)
2. Set an intention phrase for each: "I'm here to catch up with friends," "I'm here to watch a tutorial," something concrete
3. Next time you visit, Intender asks you to type your intention.

🌿 Why not just use a blocker?

Blockers get frustrating fast. You want to check something, the extension says no, you disable it. Intender doesn't fight you: it reminds you of your purpose. You decide if you want to follow it.

✨ Features:

- Clean, unhurried intention pages: designed for focus, not friction
- Target whole sites or just the parts that hook you (e.g. youtube.com/shorts)
- Easy typing: small typos are forgiven
- Quick-add from the toolbar without leaving your current tab
- Settings page for managing everything in one place
- Import/export for backup or sharing
- Optional re-prompting when you come back after a break, so old tabs don't become new rabbit holes
- Fully offline — no account, no signup, no servers

🔒 Privacy first:

Everything stays on your device. No data leaves, no analytics, no accounts. What you're trying to do online is your business.

💛 Open source:

Free and open source under AGPL-3.0. Source code, bug reports, and contributions at: https://github.com/jonathanmoregard/intender

Install it, pick one site you keep drifting to, and see what happens this week.

---

## Permission Justifications (for review submission)

| Permission    | Single Purpose                                                                          |
| ------------- | --------------------------------------------------------------------------------------- |
| storage       | Saves user-configured intentions and extension settings locally on the device           |
| webNavigation | Detects navigation to user-configured websites to display the intention reflection page |
| tabs          | Reads the current tab URL to check against the user's configured website rules          |
| idle          | Detects user inactivity to optionally re-prompt intentions after time away              |

## Privacy Policy URL

https://github.com/jonathanmoregard/intender/blob/master/privacy-policy.md

## Homepage URL

https://github.com/jonathanmoregard/intender

## Support URL

https://github.com/jonathanmoregard/intender/issues
