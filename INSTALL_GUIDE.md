# Intender Extension - Installation Guide for Testers

## Download

Download the latest version: [intender-chrome.zip](https://github.com/jonathanmoregard/intender/releases/latest/download/intender-chrome.zip)

## Installation Steps

### 1. Download the Extension

- Click the download link above
- Save the `intender-chrome.zip` file to your computer

### 2. Extract the Files

- Right-click the zip file and select "Extract All" (Windows) or double-click (Mac)
- Extract to a folder you can easily find (like Desktop)

### 3. Open Chrome Extensions Page

- Open Google Chrome
- Go to `chrome://extensions/` in the address bar
- Or: Menu → More Tools → Extensions

### 4. Enable Developer Mode

- Toggle the "Developer mode" switch in the top-right corner
- This enables manual extension installation

### 5. Load the Extension

- Click "Load unpacked" button
- Navigate to the extracted folder and select the `chrome-mv3` folder
- Click "Select Folder"

### 6. Verify Installation

- The Intender extension should now appear in your extensions list
- You should see the Intender icon in your Chrome toolbar
- Click the icon to open the popup and test the extension

## Troubleshooting

**Extension not appearing in toolbar:**

- Click the puzzle piece icon in Chrome toolbar
- Find "Intender" and click the pin icon

**Extension not loading:**

- Check that you selected the `chrome-mv3` folder (not the parent folder)
- Ensure Developer mode is enabled
- Try refreshing the extensions page

## Migrating intentions between installs

- Before switching builds or reinstalling, open Intender → Settings.
- Click "Export intentions" to download a `.json` backup.
- After installing the new build, open Settings and click "Import intentions" to restore.
- The export format is stable across minor versions.

**Permission errors:**

- The extension needs storage and web navigation permissions
- These are automatically granted during installation

## Feedback

Please report any issues or feedback to the project maintainer at `intender-extension [at] proton [dot] me`.
