# Chrome Web Store Listing

Copy these into the Chrome Web Store developer dashboard.

---

## Title

Intender — Mindful Browsing & Intention Setter

## Short Description (132 chars max)

Set intentions before visiting websites. Add mindful friction to stay focused and break distraction habits.

## Category

Productivity

## Detailed Description

Intender helps you browse the web with intention. Instead of blocking websites, it creates a gentle moment of pause — asking you to reflect and type your reason for visiting before you enter.

**How it works:**

1. Add websites you want to be more mindful about (social media, news, streaming, etc.)
2. Set a personal intention phrase for each site — your reason for visiting
3. When you navigate to that site, Intender shows a calm reflection page where you type your intention before continuing

**Why Intender instead of a website blocker?**

Traditional blockers create frustration. Intender takes a different approach inspired by mindfulness practices: it doesn't prevent you from visiting any site. Instead, it adds a brief pause that helps you check in with yourself. Many users find this gentle friction is enough to break autopilot browsing habits.

**Features:**

- Mindful intention pages with a clean, calming design
- Flexible URL matching — works with domains, subdomains, and specific paths
- Fuzzy matching for typo-tolerant intention entry
- Quick-add from the toolbar popup — set intentions without leaving your current tab
- Full settings page for managing all your intentions
- Import/export your settings for backup or sharing
- Inactivity timeout — re-prompts your intention after periods away from the tab
- Works entirely offline — no account, no signup, no servers

**Privacy first:**

Intender stores everything locally on your device. No data is collected, no analytics are sent, no accounts are required. Your browsing intentions are yours alone.

**Open source:**

Intender is free and open source under the AGPL-3.0 license. View the full source code, report bugs, or contribute at: https://github.com/jonathanmoregard/intender

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
