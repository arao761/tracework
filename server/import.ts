import { createHash } from 'node:crypto';
import type { Session, Event, Provider } from '../shared/model';
type Obj = Record<string, any>;
export function redact(text: string): string {
  return text
    .replace(
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g,
      '[REDACTED]',
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*["']?)[^\s"',;}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]{16,}/gi, '$1[REDACTED]');
}
function plain(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v))
    return v
      .map((p) => (typeof p === 'string' ? p : p?.text || p?.content || ''))
      .filter(Boolean)
      .join('\n');
  return v ? JSON.stringify(v) : '';
}
function stamp(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function args(v: any): Obj {
  if (v && typeof v === 'object') return v;
  try {
    return JSON.parse(v || '{}');
  } catch {
    return { command: String(v || '') };
  }
}
export function isFailure(output: string, flag = false): boolean {
  if (flag) return true;
  // Explicit process results take precedence over error strings printed by passing tests.
  try {
    const result = JSON.parse(output);
    if (typeof result?.exit_code === 'number') return result.exit_code !== 0;
  } catch {
    /* Plain text is the normal format. */
  }
  const code = output.match(
    /(?:Process exited with code|exit(?:ed)?(?:[_ ]code| code)[:= ]+)\s*(-?\d+)/i,
  );
  if (code) return Number(code[1]) !== 0;
  if (/"exit_code"\s*:\s*-?[1-9]\d*/.test(output)) return true;
  return /^(?:Error:|Traceback \(most recent call last\):)|ECONNREFUSED|command not found|ModuleNotFoundError|Cannot find module|missing (?:environment variable|dependency)/im.test(
    output,
  );
}
export function parseImport(
  content: string,
  filename = 'session.json',
  engineer = 'Unassigned',
): Session[] {
  if (Buffer.byteLength(content) > 20 * 1024 * 1024)
    throw new Error('File exceeds the 20 MB limit.');
  let records: Obj[];
  let canonical: Obj | undefined;
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) records = parsed;
    else if (parsed && Array.isArray(parsed.sessions)) {
      return parsed.sessions.flatMap((s: Obj) =>
        parseImport(JSON.stringify(s), filename, engineer),
      );
    } else if (parsed && Array.isArray(parsed.events)) {
      canonical = parsed;
      records = parsed.events;
    } else records = [parsed];
  } catch (err) {
    if (err instanceof Error && err.message === 'File exceeds the 20 MB limit.') throw err;
    records = content.split(/\r?\n/).flatMap((line, i) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line)];
      } catch {
        throw new Error(
          `Invalid JSON on line ${i + 1}. Export JSON or JSONL, not a text transcript.`,
        );
      }
    });
  }
  if (!records.length || records.some((r) => !r || typeof r !== 'object'))
    throw new Error('No supported session events found.');
  const execFormat = records.some(
    (r) => r.type === 'thread.started' || r.type === 'item.completed',
  );
  const isCodex =
    execFormat || records.some((r) => r.type === 'session_meta' || r.type === 'response_item');
  const isClaude = records.some(
    (r) =>
      r.sessionId ||
      (r.type === 'system' && r.session_id) ||
      ((r.type === 'assistant' || r.type === 'user') && r.message),
  );
  if (!canonical && !isCodex && !isClaude)
    throw new Error(
      'Unsupported format. Use a Codex or Claude Code JSONL export, or the sample JSON schema.',
    );
  const provider: Provider = canonical
    ? ['Codex', 'Claude Code'].includes(canonical.provider)
      ? canonical.provider
      : 'Other'
    : isCodex
      ? 'Codex'
      : 'Claude Code';
  const meta = records.find((r) => r.type === 'session_meta')?.payload || {};
  // Claude exports can contain several sessions; keep their contexts separate.
  const fallbackId = createHash('sha256').update(content).digest('hex');
  const ids = canonical
    ? [String(canonical.sourceId || canonical.id || fallbackId)]
    : provider === 'Codex'
      ? [
          String(
            meta.id || records.find((r) => r.type === 'thread.started')?.thread_id || fallbackId,
          ),
        ]
      : ([...new Set(records.map((r) => r.sessionId || r.session_id).filter(Boolean))] as string[]);
  if (!ids.length) ids.push(fallbackId);
  return ids.map((sourceId) => {
    const subset =
      provider === 'Claude Code' && !canonical
        ? records.filter(
            (r) => !(r.sessionId || r.session_id) || (r.sessionId || r.session_id) === sourceId,
          )
        : records;
    const events: Event[] = [];
    const calls = new Map<string, Event>();
    const add = (kind: Event['kind'], text: string, r: Obj, extra: Partial<Event> = {}) => {
      const e: Event = {
        id: `e${events.length + 1}`,
        kind,
        text: redact(text),
        timestamp: stamp(r.timestamp || r.createdAt),
        ...extra,
      };
      for (const key of ['command', 'output'] as const) if (e[key]) e[key] = redact(e[key]!);
      events.push(e);
      if (e.callId) calls.set(e.callId, e);
      return e;
    };
    for (const r of subset) {
      if (canonical) {
        if (!['prompt', 'response', 'tool'].includes(r.kind)) continue;
        add(r.kind, plain(r.text || r.command || r.tool), r, {
          tool: r.tool ? String(r.tool) : undefined,
          command: r.command ? plain(r.command) : undefined,
          completedAt: stamp(r.completedAt),
          output: r.output ? plain(r.output) : undefined,
          failed: r.kind === 'tool' ? isFailure(plain(r.output), r.failed === true) : undefined,
        });
        continue;
      }
      if (provider === 'Codex' && execFormat) {
        const item = r.item || {};
        if (r.type === 'item.completed' && item.type === 'agent_message')
          add('response', plain(item.text), r);
        if (
          ['item.started', 'item.updated', 'item.completed'].includes(r.type) &&
          ['command_execution', 'file_change', 'mcp_tool_call'].includes(item.type)
        ) {
          const tool =
            item.type === 'command_execution'
              ? 'exec_command'
              : item.type === 'file_change'
                ? 'apply_patch'
                : item.tool || 'mcp_tool';
          const command = plain(
            item.command ||
              item.changes?.map((c: Obj) => c.path).join('\n') ||
              item.arguments ||
              '',
          );
          const output =
            item.type === 'command_execution'
              ? plain(item.aggregated_output)
              : item.type === 'file_change'
                ? plain(item.status)
                : plain(item.result || item.error);
          let event = calls.get(item.id);
          if (!event) event = add('tool', tool, r, { tool, command, callId: item.id });
          if (r.type === 'item.completed') {
            event.completedAt = stamp(r.timestamp);
            event.output = redact(output);
            event.failed =
              typeof item.exit_code === 'number'
                ? item.exit_code !== 0
                : isFailure(output, item.status === 'failed' || !!item.error);
          }
        }
        continue;
      }
      if (provider === 'Codex') {
        const p = r.payload || {};
        if (
          r.type === 'response_item' &&
          p.type === 'message' &&
          ['user', 'assistant'].includes(p.role)
        ) {
          const text = plain(p.content);
          if (
            !/^(?:<environment_context>|<permissions|<user_instructions>|# AGENTS\.md instructions)/.test(
              text.trimStart(),
            )
          )
            add(p.role === 'user' ? 'prompt' : 'response', text, r);
        }
        if (r.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(p.type)) {
          const a = args(p.arguments || p.input);
          add('tool', p.name || 'Tool', r, {
            tool: p.name,
            command: plain(a.cmd || a.command || a.code || a.input || p.input || p.arguments || ''),
            callId: p.call_id,
          });
        }
        if (
          r.type === 'response_item' &&
          ['function_call_output', 'custom_tool_call_output'].includes(p.type)
        ) {
          const e = calls.get(p.call_id);
          if (e) {
            e.completedAt = stamp(r.timestamp);
            e.output = redact(plain(p.output));
            e.failed = isFailure(e.output);
          }
        }
        // event_msg user/assistant mirrors response_item in many Codex exports: fallback only below.
      } else {
        const msg = r.message || {};
        for (const block of Array.isArray(msg.content)
          ? msg.content
          : [{ type: 'text', text: msg.content }]) {
          if (block.type === 'text' && block.text)
            add(r.type === 'user' ? 'prompt' : 'response', block.text, r);
          if (block.type === 'tool_use') {
            const a = args(block.input);
            add('tool', block.name || 'Tool', r, {
              tool: block.name,
              command: plain(a.command || a.cmd || a.file_path || a.path || a.pattern || ''),
              callId: block.id,
            });
          }
          if (block.type === 'tool_result') {
            const e = calls.get(block.tool_use_id);
            if (e) {
              e.completedAt = stamp(r.timestamp);
              e.output = redact(plain(block.content));
              e.failed = isFailure(e.output, block.is_error === true);
            }
          }
        }
      }
    }
    if (provider === 'Codex' && !events.some((e) => e.kind === 'prompt'))
      for (const r of subset)
        if (r.type === 'event_msg' && r.payload?.type === 'user_message')
          add('prompt', r.payload.message || '', r);
    if (!events.length)
      throw new Error('The file contains metadata but no supported conversation or tool events.');
    events.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    const first = subset.find((r) => r.cwd || r.message?.model) || {};
    const project =
      redact(String(canonical?.project || meta.cwd || first.cwd || 'Unknown project'))
        .split(/[\\/]/)
        .filter(Boolean)
        .at(-1) || 'Unknown project';
    const title = redact(
      String(canonical?.title || events.find((e) => e.kind === 'prompt')?.text || filename),
    )
      .replace(/<[^>]+>/g, '')
      .slice(0, 160);
    const id = createHash('sha256').update(`${provider}:${sourceId}`).digest('hex').slice(0, 24);
    return {
      id,
      sourceId: redact(sourceId),
      title,
      project,
      engineer: redact(engineer.trim() || 'Unassigned'),
      provider,
      model: String(
        canonical?.model ||
          subset.find((r) => r.message?.model)?.message.model ||
          subset.find((r) => r.type === 'turn_context')?.payload?.model ||
          'Unknown',
      ),
      startedAt: events.find((e) => e.timestamp)?.timestamp || null,
      events,
      outcome: 'unreviewed',
      notes: '',
      prUrl: '',
      demo: false,
    };
  });
}
