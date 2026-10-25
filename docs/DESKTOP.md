# Tracework Desktop — implementation and release contract

## End-to-end behavior

- Installable macOS application, built for this Mac's Apple Silicon architecture, bundling its own Node runtime and all frontend/backend/MCP code. No npm, system Node, repository checkout, or developer absolute paths required at runtime.
- Isolated, sandboxed Electron renderer. Session parsing, SQLite and local directory polling run in a separate bundled backend process.
- First-run explanation, demo workspace and explicitly enabled source connections. No personal history scanned during installation or tests.
- Persistent SQLite data and versioned preferences under Electron's userData directory; never inside the installed bundle. Existing web-development data stays separate.
- Single instance; closing the window keeps collection running in the tray by default, with a setting to quit instead. Explicit Quit stops the backend. Optional launch at login, disabled by default.
- Native folder selection, open-data-folder action, desktop settings and version information.
- Random loopback port per launch, per-launch authentication, renderer authorization injected outside page JavaScript, separate read-only MCP token. No unauthenticated access to session data.
- Stable per-user MCP launcher regenerated when the application moves or upgrades. The MCP client discovers the latest port/token at each call. Configuring the coding tool remains explicit.
- No untrusted navigation, popups or renderer filesystem access. External HTTPS documentation opens in the system browser only after a user click.
- Export/save, file imports, confirmations, clipboard actions and keyboard shortcuts work in the desktop app.
- Packaged build, installer and checksums. Release configuration supports signed/notarized macOS builds and an HTTPS update feed. Missing signing credentials or update infrastructure must be stated clearly, not treated as completed publication.

## Verification

- Existing parser, analysis, synchronization and MCP tests remain passing.
- Authenticate all desktop API reads/writes; MCP credential cannot write or connect sources.
- Verify data survives backend/app restart, runtime discovery refreshes after restart, and native compiled MCP speaks stdio from outside the project directory.
- Launch the packaged application with isolated disposable data. Verify native window, import, folder flow, live sync from fixtures, notes, export, tray close/reopen and clean quit.
- Verify the bundled runtime executes without Homebrew dependencies and contains the expected checksum-verified official Node build.
- Do not claim signing, notarization, public hosting, automatic-update delivery, Windows testing or Intel testing unless actually performed.
