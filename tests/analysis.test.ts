import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseImport, isFailure, redact } from '../server/import';
import { findings, metrics, aggregate } from '../shared/analysis';
const fixture = (n: string) => readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8');
test('canonical imports produce traceable findings and start unreviewed', () => {
  const [s] = parseImport(fixture('canonical.json'), 'example', 'Test Engineer');
  assert.equal(s.outcome, 'unreviewed');
  assert.equal(s.engineer, 'Test Engineer');
  assert.deepEqual(
    findings(s).map((f) => f.rule),
    ['retry-loop', 'environment', 'verification'],
  );
  assert.ok(findings(s).every((f) => f.evidence.every((id) => s.events.some((e) => e.id === id))));
  assert.equal(metrics(s).failures, 3);
});
test('Codex joins call outputs and reads project/model', () => {
  const [s] = parseImport(fixture('codex.jsonl'));
  assert.equal(s.provider, 'Codex');
  assert.equal(s.project, 'claims-service');
  assert.equal(s.model, 'example-model');
  assert.equal(s.events.length, 2);
  assert.equal(s.events[1].failed, false);
  assert.match(s.events[1].output!, /8 passed/);
  assert.equal(aggregate([s]).reviewed, 0);
});
test('Claude Code normalizes tools without treating results as prompts', () => {
  const [s] = parseImport(fixture('claude-code.jsonl'));
  assert.equal(s.provider, 'Claude Code');
  assert.equal(s.events.length, 2);
  assert.equal(s.events.filter((e) => e.kind === 'prompt').length, 1);
  assert.equal(s.events[1].tool, 'Edit');
  assert.equal(findings(s)[0].rule, 'verification');
});
test('Claude multi-session exports stay separated', () => {
  const rows = fixture('claude-code.jsonl');
  const sessions = parseImport(
    rows + '\n' + rows.replaceAll('example-claude-001', 'example-claude-002'),
  );
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].id, sessions[1].id);
  assert.equal(sessions[0].events.length, 2);
});
test('duplicates have stable provider-scoped IDs', () => {
  const f = fixture('canonical.json');
  assert.equal(parseImport(f)[0].id, parseImport(f)[0].id);
  assert.notEqual(
    parseImport(f)[0].id,
    parseImport(f.replace('sample-claims-setup-001', 'another'))[0].id,
  );
});
test('malformed and unsupported inputs fail explicitly', () => {
  assert.throws(() => parseImport('{"type":"session_meta"}\nnot json'), /line 2/);
  assert.throws(() => parseImport('{}'), /Unsupported/);
  assert.throws(() => parseImport('[]'), /No supported/);
  assert.throws(() => parseImport('{"type":"session_meta","payload":{"id":"empty"}}'), /metadata/);
});
test('mentioning error is not a failed tool result', () => {
  assert.equal(isFailure('0 errors, tests passed'), false);
  assert.equal(isFailure('Documentation about error handling'), false);
  assert.equal(isFailure('Process exited with code 0'), false);
  assert.equal(isFailure('Process exited with code 2'), true);
  assert.equal(isFailure('anything', true), true);
});
test('known secret forms are redacted', () => {
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
  const out = redact(`API_KEY=${secret}\npassword="hunter2"\nBearer abcdefghijklmnopqrstuvwxyz`);
  assert.ok(!out.includes(secret));
  assert.ok(!out.includes('hunter2'));
  assert.ok(!out.includes('abcdefghijklmnopqrstuvwxyz'));
});
test('time gaps are capped and missing timestamps add no time', () => {
  const [s] = parseImport(fixture('canonical.json'));
  s.events = [
    { id: 'a', timestamp: '2026-10-24T10:00:00Z', kind: 'prompt', text: 'a' },
    { id: 'b', timestamp: '2026-10-24T12:00:00Z', kind: 'response', text: 'b' },
    { id: 'c', timestamp: null, kind: 'response', text: 'c' },
  ];
  assert.equal(metrics(s).activeMinutes, 5);
  assert.equal(metrics(s).spanMinutes, 120);
  s.events = [s.events[0]];
  assert.equal(metrics(s).activeMinutes, 0);
});
test('successful verification prevents missing-verification finding', () => {
  const [s] = parseImport(fixture('canonical.json'));
  s.events.push({
    id: 'last',
    timestamp: null,
    kind: 'tool',
    text: 'test',
    command: 'npm test',
    output: 'passed',
    failed: false,
  });
  assert.ok(!findings(s).some((f) => f.rule === 'verification'));
});
test('a verification command without a result is not considered verified', () => {
  const [s] = parseImport(fixture('canonical.json'));
  s.events.push({
    id: 'unreturned',
    timestamp: null,
    kind: 'tool',
    text: 'test',
    command: 'npm test',
    failed: false,
  });
  assert.ok(findings(s).some((f) => f.rule === 'verification'));
});
test('structured nonzero exit codes count as failures', () => {
  assert.equal(isFailure('{"exit_code":1,"output":"failed"}'), true);
  assert.equal(isFailure('{"exit_code":0,"output":"done"}'), false);
});
test('files without session IDs deduplicate by content, not file name', () => {
  const a = { events: [{ kind: 'prompt', text: 'task A' }] };
  const b = { events: [{ kind: 'prompt', text: 'task B' }] };
  assert.notEqual(
    parseImport(JSON.stringify(a), 'session.json')[0].id,
    parseImport(JSON.stringify(b), 'session.json')[0].id,
  );
  assert.equal(
    parseImport(JSON.stringify(a), 'first.json')[0].id,
    parseImport(JSON.stringify(a), 'renamed.json')[0].id,
  );
});
test('tool completion timestamps contribute to observed session activity', () => {
  const [s] = parseImport(fixture('codex.jsonl'));
  assert.equal(metrics(s).activeMinutes, 2);
  assert.equal(s.events[1].completedAt, '2026-10-24T14:03:00.000Z');
});
test('passing tests that print expected errors are not failures', () => {
  assert.equal(isFailure('Error: expected rejection\nProcess exited with code 0'), false);
  assert.equal(isFailure('{"exit_code":0,"output":"Error: expected"}'), false);
  assert.equal(isFailure('Process exited with code -1'), true);
});
test('reading a test file is not a verification run', () => {
  const [s] = parseImport(fixture('canonical.json'));
  s.events.push({
    id: 'read-test',
    timestamp: null,
    kind: 'tool',
    text: 'read',
    command: 'cat src/service.test.ts',
    output: 'test contents',
    failed: false,
  });
  assert.ok(findings(s).some((f) => f.rule === 'verification'));
});
test('Codex exec --json joins start and completion into one command', () => {
  const [s] = parseImport(fixture('codex-exec.jsonl'));
  assert.equal(s.provider, 'Codex');
  assert.equal(s.sourceId, 'example-codex-exec-001');
  assert.equal(s.events.filter((e) => e.kind === 'tool').length, 1);
  assert.equal(s.events[0].failed, false);
  assert.match(s.events[0].output!, /passed/);
  assert.equal(metrics(s).activeMinutes, 0);
});
test('Claude model metadata is found after cwd-bearing user messages', () => {
  const [s] = parseImport(fixture('claude-code.jsonl'));
  assert.equal(s.model, 'example-model');
});
test('Claude stream-json accepts session_id', () => {
  const text = fixture('claude-code.jsonl').replaceAll('sessionId', 'session_id');
  const [s] = parseImport(text);
  assert.equal(s.sourceId, 'example-claude-001');
  assert.equal(s.provider, 'Claude Code');
});
test('injected Codex environment and repo instructions are not engineer prompts', () => {
  const context = JSON.stringify({
    timestamp: '2026-10-24T14:00:02Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: '# AGENTS.md instructions for /workspace\nFollow the repo rules.',
        },
      ],
    },
  });
  const [s] = parseImport(context + '\n' + fixture('codex.jsonl'));
  assert.equal(s.title, 'Fix the claim status mapping.');
  assert.equal(metrics(s).prompts, 1);
});
test('Claude Read tool repetitions are visible as recurring context', () => {
  const [s] = parseImport(fixture('claude-code.jsonl'));
  for (let i = 0; i < 4; i++)
    s.events.push({
      id: `read-${i}`,
      timestamp: null,
      kind: 'tool',
      tool: 'Read',
      text: 'Read',
      command: 'src/policy.ts',
      output: 'source contents',
      failed: false,
    });
  assert.ok(findings(s).some((f) => f.rule === 'context'));
});
test('Codex orchestration tool inputs retain the submitted code', () => {
  const data = fixture('codex.jsonl').replace(
    '"{\\"cmd\\":\\"npm test\\"}"',
    '"{\\"code\\":\\"await tools.check()\\"}"',
  );
  const [s] = parseImport(data);
  assert.equal(s.events[1].command, 'await tools.check()');
});
