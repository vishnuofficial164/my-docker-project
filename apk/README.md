# Z10R Camera — Android APK build notes

The web app (`index.html`, `styles.css`, `app.js`) is the product; `apk/` is a thin
WebView wrapper so it installs as a native app. The APK loads the live app from
GitHub Pages, so shipping web changes needs no new APK.

## What the wrapper owns

- Camera/mic permission bridge (`MainActivity.onPermissionRequest` → runtime grant)
- Download bridge: captures saved to `Pictures/Z10R Camera` via DownloadManager
- Portrait lock, dark theme, keep-screen-on, back navigation, state restore
- External links open in the browser; only the app's own host loads in-app

## Build

Requires JDK 17, Android SDK (platforms;android-34, build-tools;34.0.0), Gradle 8.7.
Keystore is generated locally (gitignored) — command is in `apk/.gitignore`.

```
export ANDROID_HOME=/opt/android-sdk
cd apk && /opt/gradle-8.7/bin/gradle assembleRelease --no-daemon
```

Output: `apk/app/build/outputs/apk/release/app-release.apk`
Publish: copy to `download/z10r-camera-<version>.apk`, bump `versionCode`/
`versionName` in `apk/app/build.gradle`, update the href in `download/index.html`,
push to `main` — Pages serves it in ~1 minute.

## Verify a build

```
/opt/android-sdk/build-tools/34.0.0/apksigner verify --print-certs app-release.apk
/opt/android-sdk/build-tools/34.0.0/aapt dump badging app-release.apk | head -4
curl -sI https://vishnuofficial164.github.io/my-docker-project/download/z10r-camera-1.0.apk
```

## Rollback

APKs are not auto-updated: the phone keeps whatever version was installed.
To roll back the download page itself, `git revert` the offending commit on
`main`; the previous APK file is restored from git history. Keep old APK
binaries only in git history — reinstalls after uninstall need a re-download.
