export type Provider = 'Codex' | 'Claude Code' | 'Other';
export type Outcome = 'unreviewed' | 'shipped' | 'needs-work' | 'abandoned';
export type Event = {
  id: string;
  timestamp: string | null;
  completedAt?: string | null;
  kind: 'prompt' | 'response' | 'tool';
  text: string;
  tool?: string;
  command?: string;
  output?: string;
  failed?: boolean;
  callId?: string;
};
export type Session = {
  id: string;
  sourceId: string;
  title: string;
  project: string;
  engineer: string;
  provider: Provider;
  model: string;
  startedAt: string | null;
  events: Event[];
  outcome: Outcome;
  notes: string;
  prUrl: string;
  demo: boolean;
  syncSource?: 'codex' | 'claude';
  syncedAt?: string;
};
export type Finding = {
  id: string;
  rule: string;
  title: string;
  description: string;
  action: string;
  instruction: string;
  severity: 'high' | 'medium' | 'low';
  sessionId: string;
  evidence: string[];
  project: string;
};
export type Decision = 'accepted' | 'dismissed';
export type WorkEntry = {
  id: string;
  engineer: string;
  project: string;
  category: string;
  minutes: number;
  date: string;
  note: string;
};
export type Workspace = {
  sessions: Session[];
  decisions: Record<string, Decision>;
  work: WorkEntry[];
};
export const outcomeLabels: Record<Outcome, string> = {
  unreviewed: 'Unreviewed',
  shipped: 'Shipped',
  'needs-work': 'Needs work',
  abandoned: 'Abandoned',
};

export type ConnectionId = 'codex' | 'claude';
export type Connection = {
  id: ConnectionId;
  name: string;
  directory: string;
  enabled: boolean;
  engineer: string;
  since: string;
  lastSync: string | null;
  lastError: string | null;
  imported: number;
  updated: number;
  pending: number;
  errors: string[];
};
export type ConnectionsState = {
  connections: Connection[];
  pollSeconds: number;
  mcp: { codex: string; claude: string };
};
