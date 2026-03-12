# Intender

[![AGPL-3.0 License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

A browser extension that helps you pause and reflect before visiting certain websites. It gives you an opportunity to reflect and write down an intention before you enter the page.

**[Download Latest Version](https://github.com/jonathanmoregard/intender/releases/latest/download/intender-chrome.zip)** | **[Installation Guide](./INSTALL_GUIDE.md)**

## Use Cases

- **Productivity**: Add gentle friction to distracting websites like social media
- **Mindfulness**: Encourage intentional browsing habits through reflection
- **Focus**: Create moments of pause before visiting time-wasting sites

## Overview

Intender is designed to help you be more mindful about your web browsing habits. When you try to visit a configured website, the extension gives you an opportunity to reflect and write down an intention before you enter the page.

## Current Design

### Core Functionality

- **URL Matching**: The extension checks if the target URL matches any configured rules
- **Intention Page**: When a match is found, users are redirected to a custom intention page
- **Phrase Verification**: Users have an opportunity to reflect and write down their intention before continuing

### User Interface

#### Options Page

- Simple form interface for managing rules
- Each rule consists of:
  - **URL**: The website pattern to match (e.g., "facebook.com")
  - **Phrase**: The text that represents your intention for visiting the site
- Add/remove rules and save configuration

#### Intention Page

- **Modern Design**: Clean, centered card layout with subtle shadows
- **Phrase Display**: Shows the expected phrase above the input field
- **Real-time Feedback**:
  - Grey: Empty input
  - Green: Partial or complete match (shows you're on the right track)
  - Red: Incorrect input
- **Smart Button**: "Enter" button is only enabled when the phrase is complete

## Design Philosophy

Intender embraces a **mindful, non-coercive approach** to digital wellness. Rather than blocking or punishing users, it creates gentle moments of reflection and intentionality.

For detailed design specifications, see [STYLE_GUIDE.md](./STYLE_GUIDE.md).

## Contributing

Found a bug? Please use our [Bug Report Template](./BUG_REPORT_TEMPLATE.md) to report issues.

Want to contribute? See our [Contributing Guide](./CONTRIBUTING.md) for details.

_Built with [Cursor](https://cursor.sh) - the AI-first code editor._
