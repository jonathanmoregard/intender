# Privacy Policy — Intender Browser Extension

**Last updated:** 2026-03-12

## Overview

Intender is an open-source browser extension that helps you pause and reflect before visiting certain websites. Your privacy is fundamental to our design — Intender operates entirely on your device and does not collect, transmit, or share any data.

## Data Collection

**Intender does not collect any data.** Specifically:

- No personal information is collected
- No browsing history is tracked or recorded
- No analytics or telemetry data is gathered
- No data is sent to external servers
- No cookies are set by the extension
- No accounts or sign-ups are required

## Data Storage

All data is stored **locally on your device** using the browser's built-in storage API (`chrome.storage.local`). This includes:

- Your configured website rules (URL patterns and intention phrases)
- Extension settings and preferences

This data never leaves your browser. It is not synced, uploaded, or shared with anyone.

## Permissions

Intender requests the following browser permissions, used solely for its core functionality:

| Permission      | Purpose                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `storage`       | Save your configured intentions and settings locally on your device                         |
| `webNavigation` | Detect when you navigate to a website you've configured, so the intention page can be shown |
| `tabs`          | Read the current tab's URL to check it against your configured rules                        |
| `idle`          | Detect periods of inactivity to reset intention state                                       |

No permissions are used to monitor, record, or transmit your browsing activity.

## Third-Party Services

Intender does not integrate with or send data to any third-party services, APIs, or servers.

## Open Source

Intender is licensed under [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0). The full source code is available at [github.com/jonathanmoregard/intender](https://github.com/jonathanmoregard/intender) for review and verification.

## Changes to This Policy

Any changes to this privacy policy will be reflected in the extension's repository and updated here. The "Last updated" date at the top indicates the most recent revision.

## Contact

For questions about this privacy policy or the extension, contact: intender-extension@proton.me
