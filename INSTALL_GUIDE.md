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

## Updating

### For Testers (Unpacked Extension)

1. **Backup your data** (optional but recommended):
   - Open Intender → Settings
   - Click "⋯" (more options) → "Export Settings" to download a backup

2. **Update the extension (overwrite in place)**:
   - Download the latest [intender-chrome.zip](https://github.com/jonathanmoregard/intender/releases/latest/download/intender-chrome.zip)
   - Extract it into the SAME folder as your previous extraction and choose "Replace/Overwrite" when prompted
   - Keep the folder path unchanged so Chrome’s "Load unpacked" continues pointing at the same `chrome-mv3` directory
   - Go to `chrome://extensions/` and click the reload icon on the Intender card (or click the global "Update" button)

3. **Verify the update**:
   - Check the version shown on the Intender card matches the new build
   - Open the popup and Settings to confirm everything loads correctly

4. **Restore data (only if needed)**:
   - Open Settings → "⋯" → "Import Settings" to restore your backup

### For Production Users

- Updates are handled automatically through the Chrome Web Store
- No manual action required

## Troubleshooting

**Extension not appearing in toolbar:**

- Click the puzzle piece icon in Chrome toolbar
- Find "Intender" and click the pin icon

**Extension not loading:**

- Check that you selected the `chrome-mv3` folder (not the parent folder)
- Ensure Developer mode is enabled
- Try refreshing the extensions page

**Permission errors:**

- The extension needs storage and web navigation permissions
- These are automatically granted during installation

## Feedback

Please report any issues or feedback to the project maintainer at `intender-extension [at] proton [dot] me`.
