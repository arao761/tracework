import type { Session, Finding } from './model';
export function metrics(s: Session) {
  const times = s.events
    .flatMap((e) => [e.timestamp, e.completedAt].map((t) => (t ? Date.parse(t) : NaN)))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const activeMs = times.reduce(
    (sum, t, i) => sum + (i ? Math.min(Math.max(0, t - times[i - 1]), 300000) : 0),
    0,
  );
  const tools = s.events.filter((e) => e.kind === 'tool');
  return {
    activeMinutes: activeMs / 60000,
    spanMinutes: times.length ? (times.at(-1)! - times[0]) / 60000 : 0,
    tools: tools.length,
    failures: tools.filter((e) => e.failed).length,
    prompts: s.events.filter((e) => e.kind === 'prompt').length,
  };
}
export function findings(s: Session): Finding[] {
  const result: Finding[] = [];
  const tools = s.events.filter((e) => e.kind === 'tool');
  const add = (
    rule: string,
    title: string,
    description: string,
    action: string,
    instruction: string,
    severity: Finding['severity'],
    evidence: string[],
  ) =>
    result.push({
      id: `${s.id}:${rule}`,
      rule,
      title,
      description,
      action,
      instruction,
      severity,
      sessionId: s.id,
      evidence,
      project: s.project,
    });
  const groups = new Map<string, typeof tools>();
  for (const e of tools.filter((e) => e.failed)) {
    const key = (e.command || e.tool || 'unknown').trim().replace(/\s+/g, ' ');
    groups.set(key, [...(groups.get(key) || []), e]);
  }
  const loop = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (loop && loop.length >= 3)
    add(
      'retry-loop',
      'Break a repeated failure loop',
      `The same tool command failed ${loop.length} times in this session.`,
      'After the second identical failure, inspect the underlying error and change the approach before retrying.',
      'If the same command fails twice, inspect its error and prerequisites before retrying. Explain what will change in the next attempt.',
      'high',
      loop.map((e) => e.id),
    );
  const setup = tools.filter(
    (e) =>
      e.failed &&
      /ECONNREFUSED|command not found|ModuleNotFoundError|Cannot find module|missing (?:environment variable|dependency)|DATABASE_URL.*(?:missing|required|not set)/i.test(
        e.output || '',
      ),
  );
  if (setup.length)
    add(
      'environment',
      'Check prerequisites before starting',
      `${setup.length} failed tool call${setup.length === 1 ? ' points' : 's point'} to a missing dependency, service, or environment setting.`,
      'Add a preflight command that checks required services, dependencies and variable names without printing secret values.',
      'Before implementation, run the repository preflight check. If a dependency or service is missing, resolve setup before repeating application tests.',
      'high',
      setup.map((e) => e.id),
    );
  const discovery = tools.filter(
    (e) =>
      /^(rg|grep|find|ls|cat|read_file|glob|search)\b/i.test((e.command || '').trim()) ||
      /^(Read|Grep|Glob|read_file|search)$/i.test(e.tool || ''),
  );
  const repeated = new Map<string, typeof tools>();
  for (const e of discovery) {
    const key = (e.command || e.tool || '').trim();
    repeated.set(key, [...(repeated.get(key) || []), e]);
  }
  const repeat = [...repeated.values()].sort((a, b) => b.length - a.length)[0];
  if (repeat && repeat.length >= 4)
    add(
      'context',
      'Make recurring context easier to find',
      `An identical discovery command appears ${repeat.length} times. This may indicate hard-to-find context; repeated checks can also be intentional.`,
      'Review the repeated lookup. If its answer is stable, add the relevant path or architecture note to repository instructions.',
      'Read the repository architecture map before searching. Keep a short task note with discovered file paths so stable lookups do not need to be repeated.',
      'medium',
      repeat.map((e) => e.id),
    );
  const verification = tools.some(
    (e) => e.failed === false && !!e.output && isVerificationCommand(e.command || ''),
  );
  const edits = tools.filter(
    (e) =>
      /apply_patch|write_file|edit_file|str_replace|Edit|Write/i.test(e.tool || '') ||
      /\b(git apply|sed -i)\b/.test(e.command || ''),
  );
  if (edits.length && !verification)
    add(
      'verification',
      'Record a verification step',
      'File edits are visible, but no successful test, check, or build command was recognized in this export. Verification may have happened outside the session.',
      'Run a check appropriate to the change and record the result, or add a note explaining manual verification.',
      'Before handoff, run the relevant verification command and report its result. If verification cannot run, explain the blocker and what remains unchecked.',
      'low',
      edits.slice(-3).map((e) => e.id),
    );
  return result;
}
export function aggregate(sessions: Session[]) {
  const rows = sessions.map(metrics);
  const tools = rows.reduce((a, b) => a + b.tools, 0);
  const failures = rows.reduce((a, b) => a + b.failures, 0);
  return {
    sessions: sessions.length,
    activeMinutes: rows.reduce((a, b) => a + b.activeMinutes, 0),
    tools,
    failures,
    failureRate: tools ? failures / tools : 0,
    reviewed: sessions.filter((s) => s.outcome !== 'unreviewed').length,
    shipped: sessions.filter((s) => s.outcome === 'shipped').length,
  };
}

export function isVerificationCommand(command: string): boolean {
  // Match a command invocation, not a reference to a test file or a search query.
  return command
    .split(/&&|\|\||[;\n]/)
    .some((segment) =>
      /^(?:(?:cd\s+[^;]+)\s+)?(?:(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+(?:test(?:[:\s]|$)|check(?:[:\s]|$)|typecheck(?:[:\s]|$)|build(?:[:\s]|$))|(?:npx\s+|bunx\s+)?(?:pytest|vitest|jest|tsc)(?:\s|$)|python(?:3)?\s+-m\s+(?:pytest|unittest)(?:\s|$)|(?:cargo|go)\s+test(?:\s|$))/.test(
        segment.trim(),
      ),
    );
}
