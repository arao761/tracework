# Desktop release and installation

## Current deliverable

Tracework 0.3.0 is a self-contained macOS Apple Silicon (ARM64) desktop beta requiring macOS 13.5 or later. It was built on macOS, with Electron 45.0.0 and a checksum-verified official Node 24.22.1 runtime. The app bundle has an ad-hoc signature for local integrity. It does **not** have a Developer ID signature or Apple notarization. No distribution identity was available in the local keychain.

A local beta is suitable for evaluating the implementation. This is not a claim that it will pass Gatekeeper as a publicly downloaded application. Do not disable OS security protections to distribute it; produce a properly signed/notarized release using your Apple Developer credentials.

## Install and use

1. Open `Tracework-0.3.0-mac-arm64.dmg` and drag Tracework to Applications.
2. Launch Tracework and use the demo, or explicitly connect the desired session directories.
3. In Connections, optionally enable launch at login, choose close-window behavior, and copy the MCP setup command for the coding tool you use.
4. Keep the app running while collecting or using MCP. Quit stops the service.

The DMG does not install Node or edit your coding-tool settings. The application bundles its runtime, backend and MCP code. Only explicitly enabled session directories are collected.

## Import an existing workspace

Choose **Connections → Import workspace** and select an earlier Tracework data folder. The destination is backed up to its `backups/` folder first, and the source database stays unchanged. Enabled connections are copied too; quit the old app after migrating to avoid running two collectors.

Browser-development data lives in `data/` under the project directory and can be imported the same way.

## Data and lifecycle

- macOS data: `~/Library/Application Support/Tracework/tracework.sqlite`.
- Preferences: `preferences.json` alongside the database.
- Private runtime discovery: `runtime.json`, file permissions 0600, carrying a read-only MCP credential and current loopback address. No credential is placed in the UI URL.
- Stable MCP launcher: `bin/tracework-mcp`, regenerated when the app launches from a new installation location.
- Local diagnostic logs: `logs/desktop.log`, with bounded rotation. No telemetry service.
- Schema version: SQLite `user_version=1`. Newer unsupported database versions are rejected instead of overwritten.
- Close window: hides to the menu bar by default. Explicit Quit terminates the service. Optional launch at login is off until enabled.

## Build locally

```sh
npm ci
npm run desktop:build
npm test
npm run desktop:test
npm run desktop:dist
npm run desktop:verify
```

`desktop:prepare` downloads a pinned Node release from nodejs.org and verifies the archive against official SHA-256 sums. The runtime must link only to system libraries, not Homebrew libraries. Signing modifies Mach-O binaries, so the manifest records pre-signing binary provenance; packaged verification uses the executable version and bundle code-signature integrity.

The final artifact is generated under `release/` by default. `TRACEWORK_OUTPUT_DIR` can choose a different build output directory without changing runtime storage. `TRACEWORK_TARGET_ARCH` / `TRACEWORK_TARGET_PLATFORM` select a runtime for build automation; pass the corresponding electron-builder target flags too. ARM64 macOS is the only locally verified target.

## Signed and notarized release

Configure these in a controlled release environment rather than committing credentials:

- `CSC_LINK`: Developer ID Application signing certificate, normally exported as a password-protected P12, or use a suitable `CSC_NAME` identity in the build keychain.
- `CSC_KEY_PASSWORD`: certificate password where applicable.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: notarization credentials. electron-builder also supports its documented App Store Connect API-key route.
- `TRACEWORK_UPDATE_URL`: an HTTPS base URL for update artifacts and metadata.
- `TRACEWORK_RELEASE=1`: enforce release requirements and reject a release build missing its prerequisites.

```sh
npm run desktop:build
npx electron-builder --config electron-builder.config.cjs --publish never
npm run desktop:verify
```

Release-mode environment variables must be present for both desktop bundling and electron-builder. Both the Electron bundle and the standalone Node binary are included in signing. Notarization is enabled for configured signed macOS builds.

The GitHub Actions workflow provides an unsigned beta job and a protected-environment signed-release job for version tags. It builds and uploads artifacts; it does not automatically publish your repository or upload binaries to a public hosting provider. Its signed-release job requires the repository secrets and update URL before it can succeed. No CI run or public release has been performed from this workspace.

## Automatic updates

The update code is implemented with electron-updater and enables itself only in a packaged build whose release configuration declares signing and an HTTPS feed. The user checks for updates, approves a download, then approves a restart. Local workspace data stays outside the installed application.

For the beta, the app explicitly reports that updates are not configured. To enable delivery, host the generated ZIP, blockmap and `latest-mac.yml` at the configured feed URL, using signed/notarized artifacts. Keep previous releases available while updating. An update-feed host has not been provisioned here, so end-to-end download/install of a public update is not claimed as tested.

## Verification scope

Automated checks cover session parsing, metrics, decisions, persistence, opt-in sources, authentication, read-only MCP access, actual stdio launch, compiled backend/MCP operation outside the repository, port/credential discovery after restart, and consistent live database snapshots. Package verification checks required resources, Node runtime version, absence of Homebrew dynamic-library dependencies and macOS code-signature integrity.

Native onboarding and desktop settings were opened successfully in the packaged Electron window. Windows, Linux, Intel macOS, Apple notarization and public update-feed delivery require their respective external environments and are not represented as verified.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron distribution](https://www.electronjs.org/docs/latest/tutorial/distribution-overview), [electron-builder code signing](https://www.electron.build/code-signing/), [electron-builder updates](https://www.electron.build/auto-update/).

The installer was also mounted, copied to a separate location, and launched with system PATH restricted to `/usr/bin:/bin`. Its authenticated API, installed MCP launcher and automatic backend recovery passed. The runtime links only to system libraries.
