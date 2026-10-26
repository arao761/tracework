import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findings } from '../shared/analysis';
import { findingSignature, proposeFix, recurrence } from '../shared/improvements';
import type { Improvement, Session } from '../shared/model';

function session(
  id: string,
  date: string | null,
  output = 'ECONNREFUSED',
  command = 'npm test',
): Session {
  return {
    id,
    sourceId: id,
    title: id,
    project: 'api',
    engineer: 'Engineer',
    provider: 'Codex',
    model: '',
    startedAt: date,
    outcome: 'unreviewed',
    notes: '',
    prUrl: '',
    demo: false,
    events: [
      {
        id: `${id}-tool`,
        timestamp: date,
        kind: 'tool',
        tool: 'shell',
        command,
        output,
        failed: true,
        text: '',
      },
    ],
  };
}
function improvement(source: Session, sessions = [source]): Improvement {
  const finding = findings(source).find((f) => f.rule === 'environment')!;
  return {
    id: finding.id,
    finding,
    signature: findingSignature(finding, source),
    proposal: proposeFix(finding, sessions),
    acceptedAt: '2026-10-25T12:00:00Z',
    appliedAt: null,
    baselineSessionIds: sessions.map((s) => s.id),
  };
}
test('proposals group matching prerequisites across sessions and keep commands out of instructions', () => {
  const source = session(
    'source',
    '2026-10-24T12:00:00Z',
    'ECONNREFUSED',
    'npm test; untrusted-text',
  );
  const matching = session(
    'matching',
    source.startedAt,
    'ECONNREFUSED',
    'npm test; untrusted-text',
  );
  const unrelated = session(
    'unrelated',
    source.startedAt,
    'command not found',
    'npm test; untrusted-text',
  );
  const otherProject = { ...matching, id: 'other', project: 'web' };
  const proposal = improvement(source, [source, matching, unrelated, otherProject]).proposal;
  assert.equal(proposal.sources.length, 2);
  assert.equal(proposal.target, 'AGENTS.md');
  assert.match(proposal.content, /health check/);
  assert.doesNotMatch(proposal.content, /untrusted-text/);
  const claude = { ...source, provider: 'Claude Code' as const };
  assert.equal(improvement(claude).proposal.target, 'CLAUDE.md');
});
test('follow-up excludes baseline sessions, historical imports, undated and other projects', () => {
  const source = session('source', '2026-10-24T12:00:00Z');
  const fix = improvement(source);
  const later = session('later', '2026-10-25T13:00:00Z');
  const old = session('old-import', '2026-10-23T13:00:00Z');
  const unknown = session('undated', null);
  const differentFailure = session('dependency', later.startedAt, 'Cannot find module');
  const differentCommand = session('command', later.startedAt, 'ECONNREFUSED', 'npm run build');
  const noTools = { ...session('empty', later.startedAt), events: [] };
  const differentProject = { ...later, id: 'other', project: 'web' };
  const result = recurrence(fix, [
    source,
    later,
    old,
    unknown,
    differentFailure,
    differentCommand,
    noTools,
    differentProject,
  ]);
  assert.equal(result.observed, 3);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].sessionId, 'later');
  assert.equal(result.undated, 1);
  assert.equal(result.withoutTools, 1);
  // An appended baseline session must not become a new follow-up observation.
  assert.equal(recurrence(fix, [{ ...source, startedAt: later.startedAt }]).observed, 0);
});
test('marking applied changes the observation window without implying causality', () => {
  const source = session('source', '2026-10-24T12:00:00Z');
  const fix = improvement(source);
  const beforeApplied = session('before', '2026-10-25T13:00:00Z');
  const afterApplied = session('after', '2026-10-25T15:00:00Z');
  assert.equal(recurrence(fix, [beforeApplied, afterApplied]).matches.length, 2);
  fix.appliedAt = '2026-10-25T14:00:00Z';
  const result = recurrence(fix, [beforeApplied, afterApplied]);
  assert.equal(result.observed, 1);
  assert.equal(result.matches.length, 1);
});
test('a single later failed command counts even below the original retry threshold', () => {
  const source = session('source', '2026-10-24T12:00:00Z', 'Exit code: 1');
  source.events = Array.from({ length: 3 }, (_, i) => ({ ...source.events[0], id: `e-${i}` }));
  const finding = findings(source).find((f) => f.rule === 'retry-loop')!;
  const fix: Improvement = {
    id: finding.id,
    finding,
    signature: findingSignature(finding, source),
    proposal: proposeFix(finding, [source]),
    acceptedAt: '2026-10-25T12:00:00Z',
    appliedAt: null,
    baselineSessionIds: [source.id],
  };
  const later = session('later', '2026-10-25T13:00:00Z', 'Exit code: 1');
  assert.equal(findings(later).length, 0);
  assert.equal(recurrence(fix, [later]).matches.length, 1);
  const differentError = session('different-error', later.startedAt, 'Permission denied');
  assert.equal(recurrence(fix, [differentError]).matches.length, 0);
});
