# Tracework — requirements and implementation plan

## Purpose

Help a small engineering team understand coding-agent work and fix recurring friction. The app runs locally and keeps session data on the engineer’s machine.

## Users and jobs

- Engineer: import an explicitly selected session, inspect its event timeline, annotate its outcome, log manual work, and decide whether a recommendation is useful.
- Engineering lead: see recurring workflow obstacles across sessions, with evidence rather than employee scores.
- Demo viewer: explore realistic synthetic data without credentials or private source code.

## Functional requirements

1. Local web app, bound to loopback, single-user SQLite persistence. Demo and imported data remain separate.
2. Import JSON/JSONL files for Codex, Claude Code, and a canonical format; support multiple selected files, report errors per file, cap payloads at 20 MB, deduplicate sessions, reject unsupported/empty files. No automatic scanning of the user's computer.
3. Normalize prompts, responses, tool invocations/results, timestamps, model and project metadata. Parse known event shapes, tolerate unrelated valid events, reject malformed JSON with line information. Link tool calls to results. Redact common secret patterns before storage; this is best effort, not a guarantee.
4. Dashboard filters by date, engineer, project and provider; search sessions; show counts, tool failure rate, estimated observed activity, and explicitly reported outcomes. Never equate elapsed time or output volume with productivity.
5. Session detail with searchable event timeline, source evidence, session metadata, outcome (unreviewed/shipped/needs work/abandoned), notes, engineer assignment and optional PR URL.
6. Deterministic findings: repeated failing commands, missing setup prerequisites, repeated discovery commands, and no observed verification. Each includes a rule explanation, concrete next step and evidence references. No unsupported causal, cost or time-saved claims.
7. Group findings by category and project. Accept or dismiss recommendations; persist decisions. Generate a copyable suggested repository instruction. No automatic modification of repositories.
8. Manual work log for engineering work outside agent sessions, including category, engineer, project, minutes, date and note. Entries can be deleted. Do not add manual time and heuristic agent activity into a productivity score.
9. Export current filtered workspace report as JSON. Delete imported sessions individually. Empty, loading and error states must be usable.
10. Usable on desktop and mobile, keyboard accessible controls, visible focus, readable data visualization, no external fonts or analytics.

## Measurement definitions

- Session span: earliest to latest valid event time; not hours worked.
- Observed activity estimate: sum event gaps capped at five minutes, with no added time for isolated events. Approximate interaction footprint, not labor or precise active time.
- Failed tool calls: explicit error flags, nonzero parsed exit codes or narrowly recognized infrastructure failures. A mention of “error” alone is insufficient.
- Outcome: human reported. Never infer shipped from agent prose.
- Trends and percentages reflect selected dataset and filters. Missing metadata stays unknown.

## Architecture

React + TypeScript + Vite frontend, Express API, built-in Node SQLite, deterministic shared analysis engine, local file imports. No hosted services, authentication, LLM credentials, telemetry or live GitHub integration in this version. The local-only scope follows the requested project-folder development workflow.

## Build order

1. Establish schemas, import parsers and analysis rules.
2. Add SQLite API, demo seed, imports and persistent mutations.
3. Build dashboard, session explorer, evidence detail, recommendations and work log.
4. Test parser/rule edge cases and API persistence; build production bundle.
5. Exercise real browser interactions at desktop/mobile sizes; fix observed issues.
6. Deliver running local app, README, sample imports and test results.

## Acceptance checks

- Fresh startup loads clearly labeled synthetic demo data; imported workspace starts empty.
- Import each supported format; duplicates are skipped; malformed files produce useful errors without losing valid files.
- Filters affect metrics, charts, session lists and findings consistently.
- Clicking evidence opens the correct session event.
- Notes/outcomes/decisions/time entries survive refresh and server restart.
- Export contains only selected data; imported sessions can be deleted.
- Imported strings render as text; arbitrary URLs cannot become executable links.
- Production build and meaningful parser/analysis/API tests pass.

## Boundaries

Local single-user prototype, not a multi-tenant deployed service. Parser support targets documented sample shapes and may need updates for evolving exporter formats. Session bodies can contain confidential material even after secret redaction. Recommendations are heuristics to review. Financial cost, saved time and individual productivity are intentionally not inferred.

## v0.2 — automatic agent connections and in-agent access

The follow-up request adds opt-in automatic collection and MCP access, superseding the original import-only boundary.

- Connections UI for Codex and Claude Code, disabled by default, with editable source directory, engineer assignment, history window and disconnect.
- Poll selected native JSONL directories every five seconds while the app runs; dashboard polls the stored live workspace at the same interval.
- Persist source settings, file signatures and warnings. Process changed files in bounded batches. Tolerate a partially appended final record. Skip symbolic links and Claude nested subagent logs.
- Refresh live sessions without losing human notes, outcome, engineer edits or PR annotations. Suppress automatic resurrection of deleted sessions.
- Provide a real stdio MCP server with three read-only tools for summaries, session listing and evidence inspection. Generate installation commands for Codex and Claude Code; do not edit either tool's configuration automatically.
- Accept native Codex logs, Codex exec JSON event streams, native Claude Code logs, and Claude stream JSON session IDs.
- Test the file lifecycle (initial scan, appended events, malformed files, batches, restart, disconnect and deletion), provider formats, a real MCP handshake and a spawned stdio client/server exchange. Verify the UI against disposable local source directories rather than personal history.

Limitations: local single-user collection only; no cloud session fetch, cross-machine team aggregation, keystroke capture or always-running OS service. Provider on-disk formats can change. MCP excerpts enter the invoking coding agent's model context when called.
