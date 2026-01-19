# Android Build Setup

## Current Configuration

### SDK Location

- **SDK Path:** `/usr/lib/android-sdk`
- **Ownership:** User-owned (permissions fixed)
- **Configuration:** `app/android/local.properties` contains `sdk.dir=/usr/lib/android-sdk`

### Installed Components

- ✅ Android SDK Command-Line Tools (latest)
- ✅ NDK 27.1.12297006
- ✅ Build-Tools 36.0.0
- ✅ Build-Tools 35.0.0
- ✅ Platform SDK 36
- ✅ All SDK licenses accepted

### Environment Variables

Configured in `~/.zshrc`:

```bash
export ANDROID_HOME=/usr/lib/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

## Build Commands

### Build Debug APK

```bash
cd /home/jonathan/Repos/intender/app/android
./gradlew assembleDebug
```

The APK will be generated at:

```
app/android/app/build/outputs/apk/debug/app-debug.apk
```

### Build Release APK

```bash
cd /home/jonathan/Repos/intender/app/android
./gradlew assembleRelease
```

### Clean Build

```bash
cd /home/jonathan/Repos/intender/app/android
./gradlew clean
./gradlew assembleDebug
```

### Install SDK Components (if needed)

If Gradle reports missing SDK components, install them with:

```bash
sudo /usr/lib/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/usr/lib/android-sdk --no_https "component-name;version"
```

Example:

```bash
sudo /usr/lib/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/usr/lib/android-sdk --no_https "build-tools;34.0.0"
```

## Current Build Status

**Last Build:** Failed at Kotlin compilation stage

**Errors:**

- `IntenderModule.kt`: ActivityEventListener interface mismatch
- `IntenderVpnService.kt`: Null safety issue with `setConfigureIntent(null)`

These are code issues, not SDK/dependency problems. SDK setup is complete and working.

## Notes

- SDK directory is user-owned, so Gradle can auto-download missing components
- Use `--no_https` flag with sdkmanager if HTTPS downloads fail
- All licenses are accepted, so Gradle can install components automatically
