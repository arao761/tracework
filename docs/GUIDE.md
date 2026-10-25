# Tracework

**Understand coding-agent work. Find friction. Make the next session better.**

A local app for reviewing coding-agent sessions, recording outcomes, and finding recurring workflow problems.

## Desktop app (recommended)

Tracework now has an Electron desktop application for Apple Silicon Macs running macOS 13.5 or later. The macOS Apple Silicon installer is built locally in `release-desktop/Tracework-0.3.0-mac-arm64.dmg`; normal builds default to `release/`.

Open the DMG and drag **Tracework** to Applications. The application bundles its own Node runtime and backend; users do not need Node, npm, a terminal, or a repository checkout. This local beta is ad-hoc signed and **not Apple-notarized**. Trusted public distribution requires the signing/notarization and update-feed setup described in `DESKTOP-RELEASE.md`.

On first launch, explore the demo or connect your tools. **Connections → Tracework Desktop** contains background operation, optional launch at login, native folder pickers, update status, and local storage controls. Closing the window keeps collection running by default; **Quit Tracework** stops it. Launch at login is off by default.

Data lives under `~/Library/Application Support/Tracework` on macOS, separately from the application bundle. An upgrade keeps the database and preferences. **Import workspace** copies an earlier Tracework data folder, backs up the current database first, and leaves the selected source untouched. Enabled source settings are copied too; use this only for your own workspace.

The desktop API uses a random loopback port and authentication. The sandboxed renderer receives a narrow preload bridge; filesystem access and database work run in a separate process. MCP gets a read-only token and a stable per-user launcher, with no development paths or `tsx` required. Its discovery file refreshes on restart, so existing MCP clients follow the new service address. Local files remain on the device unless you invoke MCP and return their excerpts to your coding tool's model context.

Desktop development and packaging:

```sh
npm ci
npm run desktop:build    # typecheck, frontend, checksum-verified Node runtime, bundled services
npm test                # unit/API/parser tests
npm run desktop:test    # bundled runtime, auth, restart/MCP and live database snapshot tests
npm run desktop:dev     # open Electron using built resources
npm run desktop:dist    # build an installer for the current platform/architecture
npm run desktop:verify  # verify packaged files, runtime and macOS signature
```

The build downloads the pinned official Node runtime and verifies its archive SHA-256 against the official release checksums. No Homebrew runtime is shipped. The macOS ARM64 package has been tested here. Windows/Linux packaging configurations exist but have not been built or verified on this machine.

## Browser development mode

The original local web server is retained for development. Its default port remains 4317; the desktop app uses a separate authenticated service and data directory.

### Run the web development server

Requires Node.js 22.13+ (tested on 24.3) and npm. Uses the built-in `node:sqlite` module; some Node releases print an experimental-module warning.

```sh
cd tracework
npm install
npm run dev
```

Open **http://127.0.0.1:4317**. No account, API key, or external service is required. The server listens only on loopback. Development mode reloads the frontend and restarts the API when source files change.

Production:

```sh
npm run build
npm start
```

Optional environment variables: `PORT` (default 4317), `TRACEWORK_DATA_DIR` (default `data` relative to the project). The browser development server has no account authentication; keep it on loopback. The desktop service adds per-launch authentication, but remains a single-user local product.

## Try it in two minutes

1. Explore **Demo**: 18 clearly labeled synthetic engineering sessions across three fictional projects and four engineers.
2. Open **Opportunities**, inspect a finding, then follow its source events. Accept or dismiss the suggestion.
3. Open **Sessions**, search or filter, and inspect a timeline. In **Outcome & notes**, record the actual outcome and optionally attach a PR URL.
4. Click **Import sessions** and select any of the example files in `samples/`. Assign your name. Imported sessions appear in **My data**, separate from the demo.
5. Open **Work log** and add time spent reviewing, planning, or working outside your agent session.
6. **Export** downloads a JSON report for the current dataset and filters.

## Working features

- Codex `response_item` JSONL, `codex exec --json` events, Claude Code conversation/stream JSONL, and a canonical JSON schema.
- Opt-in local sync for Codex and Claude Code, with selectable history windows, incremental refresh, preserved reviews, and disconnect controls.
- Optional read-only MCP server for querying Tracework directly from either coding agent.
- Multiple files, per-file error reporting, session deduplication, and a 20 MB total frontend upload limit.
- Local SQLite persistence for sessions, notes, reported outcomes, PR annotations, recommendation decisions, and manual time entries.
- Dashboard metrics, daily tool-call chart, outcome breakdown, engineer/project/provider/date filters, session search, outcome filter, and sorting.
- Searchable, filterable event timelines with commands, expandable outputs, failure markers, and evidence navigation.
- Four explainable analysis rules: repeated failures, setup prerequisites, repeated discovery commands, and missing observed verification.
- Suggested repository instructions, with copy and human review. The app never changes your repository automatically.
- Individually deletable sessions and time entries; filtered JSON export.
- Responsive layout, keyboard focus styling, modal focus trapping, reduced-motion support, and no external fonts or telemetry.

## Automatic local sessions (no file imports)

Open **Connections** in Tracework. Each provider starts disabled.

1. Confirm the session directory: Codex defaults to `~/.codex/sessions`; Claude Code defaults to `~/.claude/projects`. `CODEX_HOME` and `CLAUDE_CONFIG_DIR` are respected. Custom absolute directories are supported.
2. Enter an engineer name and choose sessions modified from now on, in the past 7/30 days, or any time.
3. Click **Connect locally**. This is the opt-in to read and store local session content. The initial scan runs immediately, then checks every five seconds.
4. Click **View my sessions** to see the live workspace. The dashboard refreshes every five seconds as well.

No hook, IDE extension, API key, launch wrapper, or change to coding-tool configuration is needed. Session text stays local unless you explicitly use the MCP tools described below. Common secrets are redacted before storage, with the limitations described in Privacy.

Sync reads JSONL only, skips symbolic links and nested `subagents` directories, ignores unfinished final JSONL records until complete, and records malformed-file warnings. It processes up to 20 changed files / approximately 64 MB per cycle and caps each file at 20 MB. Discovery is bounded to 20,000 entries and eight directory levels; choose a narrower directory if a limit is reported. Large histories index in batches. Failed files do not block later batches; warnings persist until their source changes or disappears.

Review notes, outcomes, PR URLs, and engineer edits survive refreshes. Connection settings survive app restarts. Disconnect stops collection but retains already synced data. Tracework must remain running. The desktop version can stay in the tray and optionally launch at login; browser development has no OS background service. Remote/cloud-only conversations and other people's computers are not automatically available. On-disk formats are provider internals and may evolve.

## Use inside Claude Code or Codex (MCP)

The **Connections** page generates copyable setup commands. In the desktop app they reference a stable per-user launcher backed by bundled code; browser development uses the local project paths. Run the matching command yourself to register Tracework in your coding tool; this app does not silently edit either tool's configuration. Keep the local app running. Reopen the coding tool if needed, then ask:

> Use Tracework to review my recent sessions for this project. Show evidence behind recurring failures and suggest one repository improvement.

Three read-only tools are available:

- `tracework_summary`: metrics and open findings, optionally filtered by project, engineer and days.
- `tracework_sessions`: recent session metadata and IDs.
- `tracework_session`: a selected session and findings, with bounded excerpts or a specific evidence event.

The MCP server reads only Tracework's live workspace. It never enables file collection, reads the demo, changes a repository, or writes reviews. The returned text enters the model context of the tool where you invoke it; use appropriate session scopes. Imported text is untrusted evidence, not instructions.

For a different app URL, set `TRACEWORK_URL` on the MCP process. The URL is restricted to local HTTP. `npm run mcp` starts the stdio server for compatible MCP clients; it is not an interactive terminal program.

Official setup references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Claude Code MCP](https://code.claude.com/docs/en/mcp). No MCP server has been registered in your tools automatically.

## What the measurements mean

**Observed activity** sums time gaps between valid event timestamps (including returned tool-result timestamps), capped at five minutes per gap. It measures an approximate interaction footprint. It is not hours worked, precise attention time, or a productivity score. Some exports, including normal `codex exec --json` output, omit event timestamps; those events contribute no measured activity.

**Tool failure rate** is recognized failed calls divided by observed tool invocations. Explicit error flags, nonzero exit codes and specific failure signatures count. Missing output does not prove success. Truncated or unrecognized exports can undercount errors.

**Reported shipped** comes only from the engineer's review. Agent statements and passing tests never automatically mark work shipped. PR URLs are annotations, not verified GitHub status.

**Manual time** is reported separately. It may overlap with agent activity and is never added to it to estimate total labor.

**Chart window:** the daily chart shows seven calendar days. Summary cards cover the full selected period. Older imported datasets use their latest observed date as the chart endpoint when no current-week sessions are selected.

**Recommendations** are deterministic hypotheses with source evidence. For example, repeated discovery can be intentional. Accepting a suggestion records a backlog decision; it does not prove the underlying problem was fixed.

## Import formats

Import exports explicitly, or opt in to local directory sync through **Connections**. Disabled connections never scan directories. Enabled connections read matching local session files every five seconds while Tracework is running.

- Codex: conversation JSONL containing `session_meta`, `response_item` messages, `function_call`/`custom_tool_call`, and matching outputs. Typical directory: `~/.codex/sessions/`.
- Claude Code: JSONL containing `sessionId`, user/assistant messages, `tool_use`, and `tool_result`. Typical directory: `~/.claude/projects/`.
- Tracework: JSON object with `sourceId`, `title`, `project`, `provider`, optional `model`, and `events`. See `samples/canonical.json`. A `sessions` array of canonical objects is also accepted.

Canonical events have `kind` (`prompt`, `response`, `tool`), `text`, optional ISO `timestamp` and `completedAt`, and, for tools, `tool`, `command`, `output`, and `failed`.

Stable source IDs deduplicate repeated imports. Without an ID, the file content hash identifies the session. Manual duplicate imports are skipped rather than overwritten. Connected session files are refreshed when they change, preserving engineer assignments, notes, outcomes and PR links. Deleting a synced session suppresses automatic re-collection; a later explicit manual import can restore it.

Unknown events may be omitted. Metadata-only, unsupported, malformed, and empty files return errors. Exporters evolve, so unusual or newly introduced shapes may require parser changes. The included fixtures demonstrate the supported shapes rather than guaranteeing compatibility with every tool version.

## Local data and privacy

For browser development, the database is `data/tracework.sqlite`, with SQLite WAL files alongside it. The directory is Git-ignored. Common API token, password-assignment and authorization-header patterns are redacted before imported event text is stored. This is best-effort redaction, not a complete confidential-data detector; inspect sensitive exports yourself. No imported session content is sent to a model or third-party service.

The local API rejects unexpected hosts and cross-origin writes. This is a single-user local product, not a hosted multi-tenant service. Workspace reports contain event text and should be treated accordingly. To back up all state, stop the app and copy the database directory; the JSON report is an analysis export, not a complete database backup.

## Architecture

- `src/App.tsx`: React views, filters, dialogs and session review.
- `src/main.tsx`: application entry point.
- `src/style.css`: responsive design system.
- `shared/model.ts`: normalized types.
- `shared/analysis.ts`: measurement and finding rules.
- `server/import.ts`: parser, normalization, deduplication identifiers and redaction.
- `server/store.ts`: SQLite persistence and synthetic demo initialization.
- `server/connections.ts`: opt-in discovery, bounded polling, file-change caching, live refresh, and source settings.
- `server/mcp.ts`: stdio MCP server exposing read-only summary, session list, and evidence tools.
- `src/Connections.tsx`: connection controls and generated MCP installation commands.
- `server/app.ts`: validated HTTP API.
- `server/index.ts`: browser-development loopback server.
- `desktop/main.cjs` / `desktop/preload.cjs`: native lifecycle, tray, settings, sandbox and narrow IPC bridge.
- `server/desktop.ts`: authenticated packaged service and runtime discovery.
- `server/workspace-cli.ts`: consistent SQLite snapshot helper for workspace migration.
- `scripts/`: runtime preparation, desktop bundling and package verification.
- `electron-builder.config.cjs`: installer and signing configuration.
- `tests/`: parser, analysis, API validation, data isolation and database-restart tests.
- `REQUIREMENTS.md`: original requirements, build plan and acceptance criteria.

```sh
npm test        # meaningful parser, analysis and API checks
npm run check   # TypeScript
npm run build   # typecheck and production build
npm run format  # format the source
```

## Scope and next steps

This version works without an LLM: rules remain explainable, cheap and reproducible. It monitors session-file changes only for explicitly enabled connections, while the app runs. It does not track keystrokes or IDE activity, integrate GitHub, measure model cost, or infer employee productivity. A useful next experiment is to ask engineers which findings lead to actual repository improvements and measure that follow-through before adding more analytics.


