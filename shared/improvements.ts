import { findings } from './analysis';
import type { Event, Finding, FixProposal, Improvement, Session } from './model';

// Match a prerequisite family AND command, rather than counting every failure as recurrence.
function family(e: Event): string {
  const output = e.output || '';
  if (/ECONNREFUSED/i.test(output))
    return `service-unavailable:${output.match(/ECONNREFUSED\s+([^\s]+)/i)?.[1] || ''}`;
  if (/command not found/i.test(output)) return 'command-missing';
  if (/ModuleNotFoundError|Cannot find module|missing dependency/i.test(output))
    return `dependency-missing:${output.match(/(?:Cannot find module|No module named)\s+['"]([^'"]+)['"]/i)?.[1] || ''}`;
  if (/missing environment variable|DATABASE_URL.*(?:missing|required|not set)/i.test(output))
    return 'environment-missing';
  return `tool-failure:${output.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 300)}`;
}
function command(e: Event) {
  return (e.command || e.tool || 'unknown').trim().replace(/\s+/g, ' ');
}
export function findingSignature(f: Finding, s: Session): string {
  if (f.rule === 'verification') return 'verification';
  const events = s.events.filter((e) => f.evidence.includes(e.id));
  const keys = events.map((e) =>
    JSON.stringify([
      command(e),
      f.rule === 'environment' || f.rule === 'retry-loop' ? family(e) : '',
    ]),
  );
  // An environment finding can contain several prerequisites; track its first observed cause.
  return `${f.rule}:${keys[0] || ''}`;
}
export function proposeFix(f: Finding, sessions: Session[]): FixProposal {
  const origin = sessions.find((s) => s.id === f.sessionId)!;
  const signature = findingSignature(f, origin);
  const sources = sessions
    .filter((s) => s.project === f.project)
    .flatMap((s) =>
      findings(s)
        .filter((other) => findingSignature(other, s) === signature)
        .map((other) => ({ sessionId: s.id, title: s.title, evidence: other.evidence })),
    );
  const cause = origin.events.find((e) => f.evidence.includes(e.id));
  const prerequisite = cause ? family(cause) : '';
  const checks: Record<string, string> = {
    'service-unavailable':
      'Before running integration checks, confirm the required local service is running and reachable using the repository’s documented health check. If it is unavailable, report the service and setup step before retrying.',
    'command-missing':
      'Before running the workflow, confirm its required executable is installed and available on PATH. Use the version and installation steps documented by this repository; do not repeatedly retry a missing command.',
    'dependency-missing':
      'Before implementation, install dependencies using the repository’s lockfile and documented package manager. Confirm the required module can be resolved before repeating the failed check.',
    'environment-missing':
      'Before running application checks, confirm required environment variable names are configured using the repository’s example environment file. Report missing names only; never print secret values.',
  };
  const instruction =
    f.rule === 'environment' ? checks[prerequisite.split(':')[0]] || f.instruction : f.instruction;
  return {
    target: origin.provider === 'Claude Code' ? 'CLAUDE.md' : 'AGENTS.md',
    content: `\n## Workflow checks\n\n${instruction}\n`,
    rationale: `${sources.length} session${sources.length === 1 ? '' : 's'} in this project support this proposal. Review the linked events and adapt the instruction to the repository before appending it.`,
    sources,
  };
}
export function recurrence(improvement: Improvement, sessions: Session[]) {
  const since = improvement.appliedAt || improvement.acceptedAt;
  const cutoff = Date.parse(since);
  const candidates = sessions.filter(
    (s) =>
      s.project === improvement.finding.project && !improvement.baselineSessionIds.includes(s.id),
  );
  const undated = candidates.filter(
    (s) => !s.startedAt || !Number.isFinite(Date.parse(s.startedAt)),
  );
  const later = candidates.filter((s) => s.startedAt && Date.parse(s.startedAt) > cutoff);
  const observed = later.filter((s) => s.events.some((e) => e.kind === 'tool'));
  const matches = observed.flatMap((s) => {
    const f = improvement.finding;
    let evidence: string[];
    if (f.rule === 'verification' || f.rule === 'context') {
      evidence = findings(s)
        .filter((other) => findingSignature(other, s) === improvement.signature)
        .flatMap((other) => other.evidence);
    } else {
      // Even one later matching failure is a recurrence, below the original retry-loop threshold.
      evidence = s.events
        .filter(
          (e) =>
            e.kind === 'tool' &&
            e.failed &&
            `${f.rule}:${JSON.stringify([command(e), f.rule === 'environment' || f.rule === 'retry-loop' ? family(e) : ''])}` ===
              improvement.signature,
        )
        .map((e) => e.id);
    }
    return evidence.length ? [{ sessionId: s.id, title: s.title, evidence }] : [];
  });
  return {
    since,
    observed: observed.length,
    matches,
    undated: undated.length,
    withoutTools: later.length - observed.length,
  };
}
