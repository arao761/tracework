import type { Session, Event, WorkEntry } from '../shared/model';
export function demoSessions(): Session[] {
  const tasks = [
    ['Fix claim intake validation', 'claims-api', 'Maya Chen', 'Codex', 'environment'],
    ['Add policy search filters', 'agent-console', 'Alex Rivera', 'Claude Code', 'clean'],
    ['Handle duplicate webhook deliveries', 'workflow-engine', 'Sam Patel', 'Codex', 'retry'],
    ['Build endorsement review panel', 'agent-console', 'Maya Chen', 'Claude Code', 'context'],
    ['Add cancellation eligibility checks', 'claims-api', 'Jordan Lee', 'Codex', 'verify'],
    [
      'Recover browser workflow after timeout',
      'workflow-engine',
      'Alex Rivera',
      'Claude Code',
      'retry',
    ],
    ['Add structured document metadata', 'claims-api', 'Sam Patel', 'Claude Code', 'clean'],
    ['Improve claim handoff summary', 'agent-console', 'Jordan Lee', 'Codex', 'context'],
    ['Fix local database bootstrap', 'claims-api', 'Maya Chen', 'Codex', 'environment'],
    ['Add workflow execution history', 'workflow-engine', 'Sam Patel', 'Claude Code', 'clean'],
    ['Implement accessible session filters', 'agent-console', 'Alex Rivera', 'Codex', 'verify'],
    ['Verify policy update readback', 'workflow-engine', 'Jordan Lee', 'Claude Code', 'clean'],
    ['Improve attachment upload feedback', 'agent-console', 'Maya Chen', 'Codex', 'clean'],
    ['Add queue health endpoint', 'claims-api', 'Sam Patel', 'Claude Code', 'environment'],
    ['Refactor workflow retry boundary', 'workflow-engine', 'Alex Rivera', 'Codex', 'clean'],
    ['Test claims status response mapping', 'claims-api', 'Jordan Lee', 'Claude Code', 'clean'],
    ['Reduce repeated policy lookups', 'agent-console', 'Maya Chen', 'Codex', 'context'],
    ['Add workflow timeout handling', 'workflow-engine', 'Sam Patel', 'Claude Code', 'retry'],
  ] as const;
  return tasks.map(([title, project, engineer, provider, pattern], i) => {
    const start = new Date();
    start.setDate(start.getDate() - (i % 7));
    start.setHours(9 + (i % 7), 12, 0, 0);
    const events: Event[] = [];
    const add = (kind: Event['kind'], text: string, extra: Partial<Event> = {}) =>
      events.push({
        id: `e${events.length + 1}`,
        timestamp: new Date(start.getTime() + events.length * 110000).toISOString(),
        kind,
        text,
        ...extra,
      });
    add('prompt', `${title}. Follow existing patterns and keep the change focused.`);
    add('response', `I will inspect ${project}, implement the change, and verify the result.`);
    add('tool', 'Locate project instructions', {
      tool: 'exec_command',
      command: 'cat AGENTS.md',
      output: 'Use TypeScript. Run npm test before handoff.',
      failed: false,
    });
    add('tool', 'Inspect implementation', {
      tool: 'exec_command',
      command: 'rg "policyId" src',
      output: 'src/policy/service.ts:42: policyId',
      failed: false,
    });
    if (pattern === 'environment')
      for (let n = 0; n < 2; n++)
        add('tool', 'Run integration tests', {
          tool: 'exec_command',
          command: 'npm run test:integration',
          output: 'Error: connect ECONNREFUSED 127.0.0.1:5432\nProcess exited with code 1',
          failed: true,
        });
    if (pattern === 'retry')
      for (let n = 0; n < 3; n++)
        add('tool', 'Run workflow test', {
          tool: 'exec_command',
          command: 'npm test -- workflow-retry',
          output: 'Error: expected completed, received pending\nProcess exited with code 1',
          failed: true,
        });
    if (pattern === 'context')
      for (let n = 0; n < 4; n++)
        add('tool', 'Locate policy adapter', {
          tool: 'exec_command',
          command: 'rg "PolicyAdapter" src',
          output: 'src/integrations/policy-adapter.ts:12: export class PolicyAdapter',
          failed: false,
        });
    add(
      'prompt',
      pattern === 'environment'
        ? 'The database service needs to be running first.'
        : pattern === 'retry'
          ? 'Please inspect the state transition instead of rerunning the same test.'
          : 'Please keep the existing public interface.',
    );
    add('tool', 'Update implementation', {
      tool: 'apply_patch',
      command: `Update src/${project === 'agent-console' ? 'components/ReviewPanel.tsx' : 'service.ts'}`,
      output: 'Successfully updated 1 file.',
      failed: false,
    });
    add('tool', 'Inspect diff', {
      tool: 'exec_command',
      command: 'git diff --stat',
      output: '1 file changed, 24 insertions(+), 8 deletions(-)',
      failed: false,
    });
    if (pattern !== 'verify')
      add('tool', 'Verify change', {
        tool: 'exec_command',
        command: 'npm test',
        output: 'Tests: 18 passed, 18 total\nProcess exited with code 0',
        failed: false,
      });
    add(
      'response',
      pattern === 'verify'
        ? 'Implementation is ready for manual review.'
        : 'Implemented the change. Relevant tests passed.',
    );
    return {
      id: `demo-${i + 1}`,
      sourceId: `synthetic-${i + 1}`,
      title,
      project,
      engineer,
      provider,
      model: provider === 'Codex' ? 'Codex · sample' : 'Claude · sample',
      startedAt: start.toISOString(),
      events,
      outcome: i % 5 === 0 ? 'needs-work' : i % 4 === 0 ? 'unreviewed' : 'shipped',
      notes: i === 0 ? 'Demo note: add a database health check to the setup script.' : '',
      prUrl: '',
      demo: true,
    };
  });
}
export function demoWork(): WorkEntry[] {
  return [
    {
      id: 'demo-work-1',
      engineer: 'Maya Chen',
      project: 'claims-api',
      category: 'Code review',
      minutes: 35,
      date: new Date().toISOString().slice(0, 10),
      note: 'Reviewed validation and edge cases with Sam.',
    },
    {
      id: 'demo-work-2',
      engineer: 'Alex Rivera',
      project: 'workflow-engine',
      category: 'Planning',
      minutes: 50,
      date: new Date().toISOString().slice(0, 10),
      note: 'Mapped timeout recovery states before implementation.',
    },
  ];
}
