import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Command,
  ExternalLink,
  FileJson,
  Filter,
  GitPullRequest,
  HelpCircle,
  LayoutDashboard,
  Link2,
  Lightbulb,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type {
  Session,
  Workspace,
  Finding,
  FixProposal,
  Improvement,
  Outcome,
  Decision,
  Event as SessionEvent,
} from '../shared/model';
import { outcomeLabels } from '../shared/model';
import { aggregate, findings, metrics } from '../shared/analysis';
import ConnectionsPage from './Connections';
import FixReview from './FixReview';
import { proposeFix } from '../shared/improvements';

type Page = 'overview' | 'sessions' | 'insights' | 'work' | 'connections';
const pageNames: Record<Page, string> = {
  overview: 'Overview',
  sessions: 'Sessions',
  insights: 'Opportunities',
  work: 'Work log',
  connections: 'Connections',
};
const empty: Workspace = { sessions: [], decisions: {}, work: [] };
const dateLabel = (
  s: string | null,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
) => (s ? new Date(s).toLocaleDateString(undefined, opts) : 'Unknown date');
const duration = (n: number) => {
  const m = Math.round(n);
  return n === 0 ? '0m' : n < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
const initials = (s: string) =>
  s
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
const cls = (...v: (string | false | undefined)[]) => v.filter(Boolean).join(' ');
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function api(path: string, mode: string, method = 'GET', body?: unknown) {
  const res = await fetch(`/api${path}${path.includes('?') ? '&' : '?'}mode=${mode}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const [page, setPage] = useState<Page>(() => {
    const candidate = window.location.hash.slice(1);
    return Object.hasOwn(pageNames, candidate) ? (candidate as Page) : 'overview';
  });
  const [mode, setMode] = useState(localStorage.getItem('tracework-mode') || 'demo');
  const [data, setData] = useState<Workspace>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [engineer, setEngineer] = useState('all');
  const [project, setProject] = useState('all');
  const [provider, setProvider] = useState('all');
  const [range, setRange] = useState('7');
  const [outcome, setOutcome] = useState('all');
  const [sort, setSort] = useState('recent');
  const [decisionFilter, setDecisionFilter] = useState('open');
  const [selected, setSelected] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [modal, setModal] = useState<'import' | 'work' | 'method' | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(
    !!window.traceworkDesktop && !localStorage.getItem('tracework-desktop-welcome-v1'),
  );
  function finishWelcome() {
    localStorage.setItem('tracework-desktop-welcome-v1', 'seen');
    setWelcome(false);
  }
  const generation = useRef(0);
  useEffect(() => {
    history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search + (page === 'overview' ? '' : `#${page}`),
    );
    window.scrollTo(0, 0);
  }, [page]);
  async function refresh() {
    const g = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const d = await api('/workspace', mode);
      if (g === generation.current) setData(d);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    localStorage.setItem('tracework-mode', mode);
    setData(empty);
    setSelected(null);
    setEngineer('all');
    setProject('all');
    setProvider('all');
    setSearch('');
    setOutcome('all');
    void refresh();
  }, [mode]);
  useEffect(() => {
    if (mode !== 'live') return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [mode]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const filtered = useMemo(
    () =>
      data.sessions
        .filter((s) => {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - Number(range) + 1);
          return (
            (range === 'all' || (!!s.startedAt && Date.parse(s.startedAt) >= start.getTime())) &&
            (engineer === 'all' || s.engineer === engineer) &&
            (project === 'all' || s.project === project) &&
            (provider === 'all' || s.provider === provider) &&
            (outcome === 'all' || s.outcome === outcome) &&
            (!search ||
              [s.title, s.project, s.engineer, s.provider].some((t) =>
                t.toLowerCase().includes(search.toLowerCase()),
              ))
          );
        })
        .sort((a, b) =>
          sort === 'friction'
            ? findings(b).length - findings(a).length
            : sort === 'activity'
              ? metrics(b).activeMinutes - metrics(a).activeMinutes
              : (b.startedAt || '').localeCompare(a.startedAt || ''),
        ),
    [data.sessions, range, engineer, project, provider, outcome, search, sort],
  );
  const stats = aggregate(filtered);
  const currentFindings = filtered.flatMap(findings);
  const allFindings = [
    ...currentFindings,
    ...Object.values(data.improvements || {})
      .filter(
        (i) =>
          filtered.some((s) => s.id === i.finding.sessionId) &&
          !currentFindings.some((f) => f.id === i.id),
      )
      .map((i) => i.finding),
  ];
  const openFindings = allFindings.filter((f) => !data.decisions[f.id]);
  const session = data.sessions.find((s) => s.id === selected);
  const members = [
    ...new Set([...data.sessions.map((s) => s.engineer), ...data.work.map((w) => w.engineer)]),
  ].sort();
  const projects = [
    ...new Set([...data.sessions.map((s) => s.project), ...data.work.map((w) => w.project)]),
  ].sort();
  const work = data.work
    .filter(
      (w) =>
        (engineer === 'all' || w.engineer === engineer) &&
        (project === 'all' || w.project === project) &&
        (!search ||
          [w.project, w.engineer, w.note].join(' ').toLowerCase().includes(search.toLowerCase())) &&
        (range === 'all' ||
          w.date >=
            (() => {
              const d = new Date();
              d.setDate(d.getDate() - Number(range) + 1);
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            })()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const result = await api(path, mode, method, body);
      await refresh();
      return result;
    } catch (e) {
      setToast((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function decide(f: Finding, status: Decision, proposalContent?: string) {
    try {
      await mutate('/decisions', 'POST', { id: f.id, status, proposalContent });
      setToast(
        status === 'accepted' ? 'Added to your improvement backlog.' : 'Recommendation dismissed.',
      );
    } catch {}
  }
  function openEvidence(f: Finding) {
    setEvidence(f.evidence[0] || null);
    setSelected(f.sessionId);
  }
  function resetFilters() {
    setEngineer('all');
    setProject('all');
    setProvider('all');
    setOutcome('all');
    setSearch('');
    setRange('all');
  }
  const activeFilters = [engineer, project, provider, outcome].filter((x) => x !== 'all').length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('overview');
          }}
        >
          <span className="brand-mark">
            <Activity size={22} />
          </span>
          tracework<span className="brand-dot">.</span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Code2 size={17} />
          </span>
          <div>
            <strong>Engineering workspace</strong>
            <span>Local · Single user</span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {(
            [
              ['overview', LayoutDashboard],
              ['sessions', Terminal],
              ['insights', Lightbulb],
              ['work', Clock3],
              ['connections', Link2],
            ] as const
          ).map(([p, Icon]) => (
            <button
              key={p}
              className={cls('nav-item', page === p && 'active')}
              onClick={() => setPage(p)}
            >
              <Icon size={18} />
              {pageNames[p]}
              {p === 'insights' && openFindings.length > 0 && (
                <span className="nav-count">{openFindings.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-icon">
            <Zap size={16} />
          </span>
          <strong>
            Better systems.
            <br />
            Better engineering.
          </strong>
          <p>
            Find the friction.
            <br />
            Follow the evidence.
          </p>
          <button onClick={() => setModal('method')}>
            How Tracework works <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span />
            Local data only
            <ShieldCheck size={15} />
          </div>
          <button className="profile" onClick={() => setModal('method')}>
            <span className="avatar">Y</span>
            <div>
              <strong>Your workspace</strong>
              <span>No account required</span>
            </div>
            <HelpCircle size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <span>{pageNames[page]}</span>
          </div>
          <div className="topbar-actions">
            <span className="local-caption">
              <span />
              All systems local
            </span>
            <button
              className="icon-button"
              title="Measurement methodology"
              aria-label="Measurement methodology"
              onClick={() => setModal('method')}
            >
              <BookOpen size={17} />
            </button>
            <span className="avatar small">Y</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">ENGINEERING INTELLIGENCE</div>
              <h1>
                {page === 'overview'
                  ? 'A clearer view of agent work.'
                  : page === 'sessions'
                    ? 'Every session tells a story.'
                    : page === 'insights'
                      ? 'Less friction. More flow.'
                      : page === 'connections'
                        ? 'Your agents. One workspace.'
                        : 'The work beyond the session.'}
              </h1>
              <p>
                {page === 'overview'
                  ? 'Understand what happened. Find what to improve.'
                  : page === 'sessions'
                    ? 'Explore the conversations, tools, and decisions behind the work.'
                    : page === 'insights'
                      ? 'Evidence-backed suggestions for a better engineering workflow.'
                      : page === 'connections'
                        ? 'Bring sessions in automatically. Take insights back into your agent.'
                        : 'Log reviews, planning, and the effort agent traces don’t capture.'}
              </p>
            </div>
            {page !== 'connections' && (
              <div className="heading-actions">
                <button
                  className="button secondary"
                  onClick={() => {
                    download(`tracework-${mode}-${localDate()}.json`, {
                      exportedAt: new Date().toISOString(),
                      dataset: mode,
                      filters: { range, engineer, project, provider, outcome, search },
                      measurementNotes:
                        'Observed activity is a capped event-gap estimate, not hours worked. Outcomes are human reported.',
                      sessions: filtered,
                      findings: allFindings,
                      improvements: Object.values(data.improvements || {}).filter((i) =>
                        filtered.some((s) => s.id === i.finding.sessionId),
                      ),
                      decisions: Object.fromEntries(
                        allFindings
                          .filter((f) => data.decisions[f.id])
                          .map((f) => [f.id, data.decisions[f.id]]),
                      ),
                      work,
                    });
                    setToast('Filtered workspace report exported.');
                  }}
                >
                  <ArrowDownToLine size={16} />
                  Export
                </button>
                <button
                  className="button primary"
                  onClick={() => setModal(page === 'work' ? 'work' : 'import')}
                >
                  {page === 'work' ? <Plus size={16} /> : <Upload size={16} />}{' '}
                  {page === 'work' ? 'Log time' : 'Import sessions'}
                </button>
              </div>
            )}
          </div>
          {page !== 'connections' && (
            <>
              <div className={cls('dataset-bar', mode === 'live' && 'live')}>
                <div>
                  <span className="dataset-icon">
                    {mode === 'demo' ? <Sparkles size={16} /> : <ShieldCheck size={16} />}
                  </span>
                  <strong>
                    {mode === 'demo'
                      ? 'You’re exploring the demo workspace'
                      : 'Your imported workspace'}
                  </strong>
                  <span className="dataset-description">
                    {mode === 'demo'
                      ? 'Synthetic sessions. Real analysis.'
                      : 'Imported & synced sessions. Stored on this machine.'}
                  </span>
                </div>
                <div className="segmented">
                  <button
                    className={cls(mode === 'demo' && 'selected')}
                    onClick={() => setMode('demo')}
                  >
                    Demo
                  </button>
                  <button
                    className={cls(mode === 'live' && 'selected')}
                    onClick={() => setMode('live')}
                  >
                    My data
                  </button>
                </div>
              </div>
              <div className="filter-bar">
                <div className="filter-group">
                  <Filter size={15} />
                  <Select
                    label="Engineer"
                    value={engineer}
                    onChange={setEngineer}
                    options={[['all', 'All engineers'], ...members.map((x) => [x, x])]}
                  />
                  <Select
                    label="Project"
                    value={project}
                    onChange={setProject}
                    options={[['all', 'All projects'], ...projects.map((x) => [x, x])]}
                  />
                  {page !== 'work' && (
                    <Select
                      label="Provider"
                      value={provider}
                      onChange={setProvider}
                      options={['all', 'Codex', 'Claude Code', 'Other'].map((x) => [
                        x,
                        x === 'all' ? 'All agents' : x,
                      ])}
                    />
                  )}{' '}
                  {activeFilters > 0 && (
                    <button className="text-button" onClick={resetFilters}>
                      Clear {activeFilters}
                    </button>
                  )}
                </div>
                <Select
                  label="Date range"
                  value={range}
                  onChange={setRange}
                  options={[
                    ['7', 'Last 7 days'],
                    ['30', 'Last 30 days'],
                    ['all', 'All time'],
                  ]}
                />
              </div>
            </>
          )}
          {page === 'connections' ? (
            <ConnectionsPage
              onLive={() => {
                setMode('live');
                setRange('all');
                setPage('sessions');
              }}
            />
          ) : error ? (
            <div className="empty-state">
              <h2>Couldn’t load your workspace</h2>
              <p>{error}</p>
              <button className="button primary" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : loading && data.sessions.length === 0 ? (
            <div className="empty-state">
              <Loader2 className="spin" />
              <p>Loading your workspace…</p>
            </div>
          ) : (
            <>
              {page === 'overview' && (
                <>
                  <div className="metric-grid">
                    <Metric
                      title="Agent sessions"
                      value={String(stats.sessions)}
                      icon={<Terminal size={17} />}
                      footer={`${new Set(filtered.map((s) => s.project)).size} projects · ${new Set(filtered.map((s) => s.engineer)).size} engineers`}
                    />
                    <Metric
                      title="Observed activity"
                      value={duration(stats.activeMinutes)}
                      icon={<Clock3 size={17} />}
                      footer="Estimated from event gaps"
                      info="Sum of time between events, capped at five minutes per gap. Not hours worked."
                    />
                    <Metric
                      title="Tool failure rate"
                      value={`${(stats.failureRate * 100).toFixed(1)}%`}
                      icon={<Activity size={17} />}
                      footer={`${stats.failures} failed / ${stats.tools} tool calls`}
                    />
                    <Metric
                      title="Reported shipped"
                      value={`${stats.shipped}`}
                      icon={<GitPullRequest size={17} />}
                      footer={`${stats.reviewed} of ${stats.sessions} sessions reviewed`}
                      info="Outcomes are manually reported, never inferred from agent responses."
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="card chart-card">
                      <div className="card-heading">
                        <div>
                          <h2>Agent activity</h2>
                          <p>Tool calls across your selected sessions</p>
                        </div>
                        <div className="legend">
                          <span>
                            <i className="mint" />
                            No error observed
                          </span>
                          <span>
                            <i className="orange" />
                            Failed
                          </span>
                        </div>
                      </div>
                      <ActivityChart sessions={filtered} />
                      <div className="chart-foot">
                        <span>
                          <span className="dot mint" />
                          {stats.tools - stats.failures} calls with no observed error
                        </span>
                        <button className="text-button" onClick={() => setPage('sessions')}>
                          Explore sessions <ArrowRight size={14} />
                        </button>
                      </div>
                    </section>
                    <section className="card outcome-card">
                      <div className="card-heading">
                        <div>
                          <h2>Session outcomes</h2>
                          <p>Human-reported results</p>
                        </div>
                        <CheckCircle2 size={18} className="muted" />
                      </div>
                      <OutcomeChart sessions={filtered} />
                      <div className="outcome-note">
                        <HelpCircle size={14} />
                        {stats.sessions - stats.reviewed} sessions still need a human review
                      </div>
                    </section>
                  </div>
                  <div className="overview-grid lower">
                    <section className="card">
                      <div className="card-heading">
                        <div>
                          <h2>
                            Recent sessions <span className="count-chip">{filtered.length}</span>
                          </h2>
                          <p>A closer look at the work behind the numbers</p>
                        </div>
                        <button className="text-button" onClick={() => setPage('sessions')}>
                          View all <ArrowRight size={14} />
                        </button>
                      </div>
                      <SessionList
                        sessions={filtered.slice(0, 5)}
                        onOpen={(s) => {
                          setEvidence(null);
                          setSelected(s.id);
                        }}
                        compact
                      />
                      {filtered.length === 0 && (
                        <Empty onImport={() => setModal('import')} mode={mode} />
                      )}
                    </section>
                    <section className="card opportunities-card">
                      <div className="card-heading">
                        <div>
                          <h2>
                            <span className="spark">
                              <Sparkles size={17} />
                            </span>
                            Worth a closer look
                          </h2>
                          <p>Patterns that could improve your workflow</p>
                        </div>
                      </div>
                      <div className="opportunity-stack">
                        {Object.values(groupFindings(openFindings))
                          .slice(0, 3)
                          .map((group) => (
                            <button
                              className="opportunity-mini"
                              key={group[0].rule}
                              onClick={() => {
                                setPage('insights');
                                setDecisionFilter('open');
                              }}
                            >
                              <div className={cls('rule-icon', group[0].severity)}>
                                {group[0].rule === 'environment' ? (
                                  <Terminal size={17} />
                                ) : group[0].rule === 'retry-loop' ? (
                                  <Activity size={17} />
                                ) : (
                                  <BookOpen size={17} />
                                )}
                              </div>
                              <div>
                                <strong>{group[0].title}</strong>
                                <span>
                                  {group.length} sessions ·{' '}
                                  {new Set(group.map((f) => f.project)).size} projects
                                </span>
                              </div>
                              <ChevronRight size={16} />
                            </button>
                          ))}
                        {!openFindings.length && (
                          <div className="quiet-state">
                            <CheckCircle2 size={26} />
                            <strong>No open findings</strong>
                            <p>
                              {filtered.length
                                ? 'The current rules found no open patterns to review.'
                                : 'Import sessions to start finding patterns.'}
                            </p>
                          </div>
                        )}
                      </div>
                      <button className="card-bottom-link" onClick={() => setPage('insights')}>
                        Review opportunities <ArrowRight size={15} />
                      </button>
                    </section>
                  </div>
                </>
              )}
              {page === 'sessions' && (
                <section className="card sessions-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        Session explorer <span className="count-chip">{filtered.length}</span>
                      </h2>
                      <p>Open a session to inspect evidence and record its outcome.</p>
                    </div>
                    <div className="table-tools">
                      <SearchField
                        value={search}
                        onChange={setSearch}
                        placeholder="Search sessions…"
                      />
                      <Select
                        label="Outcome"
                        value={outcome}
                        onChange={setOutcome}
                        options={[['all', 'All outcomes'], ...Object.entries(outcomeLabels)]}
                      />
                      <Select
                        label="Sort sessions"
                        value={sort}
                        onChange={setSort}
                        options={[
                          ['recent', 'Most recent'],
                          ['friction', 'Most findings'],
                          ['activity', 'Most activity'],
                        ]}
                      />
                    </div>
                  </div>
                  <SessionList
                    sessions={filtered}
                    onOpen={(s) => {
                      setEvidence(null);
                      setSelected(s.id);
                    }}
                  />
                  {!filtered.length && (
                    <Empty
                      onImport={() => setModal('import')}
                      mode={mode}
                      onClear={data.sessions.length ? resetFilters : undefined}
                    />
                  )}
                </section>
              )}
              {page === 'insights' && (
                <>
                  <div className="insights-intro">
                    <div className="insight-intro-icon">
                      <Lightbulb size={23} />
                    </div>
                    <div>
                      <strong>Small improvements, backed by actual events.</strong>
                      <p>
                        These are reviewable hypotheses, not performance judgments. Every suggestion
                        links to the trace that triggered it.
                      </p>
                    </div>
                    <button className="text-button" onClick={() => setModal('method')}>
                      About the rules <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="tabs">
                    {[
                      ['open', 'To review'],
                      ['accepted', 'Accepted'],
                      ['dismissed', 'Dismissed'],
                      ['all', 'All findings'],
                    ].map(([v, l]) => (
                      <button
                        key={v}
                        className={cls(decisionFilter === v && 'active')}
                        onClick={() => setDecisionFilter(v)}
                      >
                        {l}
                        <span>
                          {
                            allFindings.filter(
                              (f) =>
                                v === 'all' ||
                                (v === 'open' ? !data.decisions[f.id] : data.decisions[f.id] === v),
                            ).length
                          }
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="finding-list">
                    {allFindings
                      .filter(
                        (f) =>
                          decisionFilter === 'all' ||
                          (decisionFilter === 'open'
                            ? !data.decisions[f.id]
                            : data.decisions[f.id] === decisionFilter),
                      )
                      .map((f) => (
                        <FindingCard
                          key={f.id}
                          finding={f}
                          session={data.sessions.find((s) => s.id === f.sessionId)!}
                          decision={data.decisions[f.id]}
                          onEvidence={() => openEvidence(f)}
                          onDecide={(v, content) => decide(f, v, content)}
                          proposal={
                            data.improvements?.[f.id]?.proposal || proposeFix(f, data.sessions)
                          }
                          improvement={data.improvements?.[f.id]}
                          sessions={data.sessions}
                          onApply={async () => {
                            await mutate('/improvements/applied', 'POST', {
                              id: f.id,
                              confirmed: true,
                            });
                          }}
                          onSource={(sessionId, eventId) => {
                            setSelected(sessionId);
                            setEvidence(eventId);
                          }}
                          disabled={busy}
                        />
                      ))}
                    {!allFindings.filter(
                      (f) =>
                        decisionFilter === 'all' ||
                        (decisionFilter === 'open'
                          ? !data.decisions[f.id]
                          : data.decisions[f.id] === decisionFilter),
                    ).length && (
                      <section className="card empty-state">
                        <CheckCircle2 size={32} />
                        <h2>Nothing here to review</h2>
                        <p>
                          {filtered.length
                            ? 'Try another tab or broaden your filters.'
                            : 'Import a session to look for recurring friction.'}
                        </p>
                      </section>
                    )}
                  </div>
                </>
              )}
              {page === 'work' && (
                <>
                  <div className="metric-grid work-metrics">
                    <Metric
                      title="Logged time"
                      value={duration(work.reduce((a, w) => a + w.minutes, 0))}
                      icon={<Clock3 size={17} />}
                      footer="Manually entered · selected period"
                    />
                    <Metric
                      title="Work entries"
                      value={String(work.length)}
                      icon={<BookOpen size={17} />}
                      footer="Planning, review, debugging, and more"
                    />
                    <div className="card work-explainer">
                      <ShieldCheck size={22} />
                      <div>
                        <strong>Context, not a productivity score.</strong>
                        <p>
                          Manual time is separate from estimated agent activity. The two can
                          overlap.
                        </p>
                      </div>
                    </div>
                  </div>
                  <section className="card">
                    <div className="card-heading">
                      <div>
                        <h2>Work outside the trace</h2>
                        <p>A lightweight record of engineering effort.</p>
                      </div>
                      <button className="button secondary" onClick={() => setModal('work')}>
                        <Plus size={16} />
                        Add entry
                      </button>
                    </div>
                    <div className="work-list">
                      {work.map((w) => (
                        <div className="work-row" key={w.id}>
                          <span className="work-icon">
                            <Clock3 size={19} />
                          </span>
                          <div className="work-detail">
                            <strong>
                              {w.category}
                              <span className="project-tag">{w.project}</span>
                            </strong>
                            <p>{w.note || 'No note added'}</p>
                            <span>
                              {w.engineer} · {dateLabel(w.date + 'T12:00:00')}
                            </span>
                          </div>
                          <strong className="work-duration">{duration(w.minutes)}</strong>
                          <button
                            className="icon-button"
                            aria-label={`Delete ${w.category} entry`}
                            onClick={async () => {
                              if (confirm('Delete this work entry?'))
                                try {
                                  await mutate(`/work/${w.id}`, 'DELETE');
                                  setToast('Entry deleted.');
                                } catch {}
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                    {!work.length && (
                      <div className="empty-state">
                        <Clock3 size={30} />
                        <h2>No time entries yet</h2>
                        <p>
                          Log a review, planning session, or other work outside your agent sessions.
                        </p>
                        <button className="button primary" onClick={() => setModal('work')}>
                          Log your first entry
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            <span>
              <Activity size={13} />
              Tracework <span className="footer-separator">/</span> Make the next session better.
            </span>
            <button onClick={() => setModal('method')}>
              Transparent by design <ArrowUpRight size={13} />
            </button>
          </footer>
        </main>
      </div>
      {session && (
        <SessionDetail
          key={session.id}
          session={session}
          evidence={evidence}
          onClose={() => setSelected(null)}
          onSave={async (b) => {
            await mutate(`/sessions/${session.id}`, 'PATCH', b);
            setToast('Session updated.');
          }}
          onDelete={async () => {
            await mutate(`/sessions/${session.id}`, 'DELETE');
            setSelected(null);
            setToast('Session deleted.');
          }}
        />
      )}
      {modal === 'import' && (
        <ImportModal
          onClose={() => setModal(null)}
          onImport={async (files, person) => {
            const result = await api('/import', 'live', 'POST', { files, engineer: person });
            if (result.imported || result.duplicates) {
              if (mode !== 'live') setMode('live');
              else await refresh();
            }
            return result;
          }}
        />
      )}
      {modal === 'work' && (
        <WorkModal
          members={members}
          projects={projects}
          onClose={() => setModal(null)}
          onSave={async (b) => {
            await mutate('/work', 'POST', b);
            setModal(null);
            setToast('Time entry saved.');
          }}
        />
      )}
      {modal === 'method' && <MethodModal onClose={() => setModal(null)} />}
      {welcome && (
        <Modal title="Welcome to Tracework" onClose={finishWelcome}>
          <div className="modal-body desktop-welcome">
            <span className="welcome-mark">
              <Activity size={30} />
            </span>
            <h2>Make your next agent session better.</h2>
            <p>
              Explore the demo first, or connect Codex and Claude Code to collect sessions
              automatically.
            </p>
            <div className="form-note">
              <ShieldCheck size={19} />
              <span>
                Connections start off. Choose which local session directories Tracework can read. No
                account or API key is required.
              </span>
            </div>
            <p>
              Closing this window keeps Tracework in the menu bar so collection can continue. Choose{' '}
              <strong>Quit Tracework</strong> to stop it, or change this behavior in Connections.
            </p>
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={finishWelcome}>
              Explore the demo
            </button>
            <button
              className="button primary"
              onClick={() => {
                finishWelcome();
                setPage('connections');
              }}
            >
              Connect my tools <ArrowRight size={14} />
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
          <button
            className="icon-button"
            onClick={() => setToast('')}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
}) {
  return (
    <label className="select-wrap">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </label>
  );
}
function Metric({
  title,
  value,
  icon,
  footer,
  info,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  footer: string;
  info?: string;
}) {
  return (
    <section className="card metric">
      <div className="metric-top">
        <span>
          {title}
          {info && (
            <span title={info} tabIndex={0} className="info-tooltip" aria-label={info}>
              <HelpCircle size={13} />
              <span>{info}</span>
            </span>
          )}
        </span>
        {icon}
      </div>
      <div className="metric-number">{value}</div>
      <div className="metric-footer">{footer}</div>
    </section>
  );
}
function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-field">
      <Search size={15} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Clear search">
          <X size={13} />
        </button>
      )}
    </label>
  );
}
function ActivityChart({ sessions }: { sessions: Session[] }) {
  const valid = sessions.filter((s) => s.startedAt);
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - 6 + i);
    return d;
  });
  // With older imports, show the seven days ending at their most recent observed event.
  if (
    valid.length &&
    !valid.some(
      (s) =>
        Date.parse(s.startedAt!) >=
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(),
    )
  ) {
    const last = new Date(Math.max(...valid.map((s) => Date.parse(s.startedAt!))));
    days.forEach((_, i) => {
      const d = new Date(last);
      d.setDate(d.getDate() - 6 + i);
      days[i] = d;
    });
  }
  const points = days.map((d) => {
    const rows = valid.filter((s) => new Date(s.startedAt!).toDateString() === d.toDateString());
    const m = aggregate(rows);
    return { date: d, total: m.tools, failed: m.failures };
  });
  const max = Math.max(...points.map((p) => p.total), 4);
  const top = Math.ceil(max / 4) * 4;
  return (
    <div className="activity-chart">
      <svg
        viewBox="0 0 620 200"
        role="img"
        aria-label="Tool calls by day, with failed calls highlighted in orange"
      >
        {[0, 1, 2, 3, 4].map((n) => (
          <g key={n}>
            <line
              x1="32"
              y1={15 + n * 38}
              x2="610"
              y2={15 + n * 38}
              stroke="#edf0f2"
              strokeDasharray="3 4"
            />
            <text x="23" y={19 + n * 38} textAnchor="end" fontSize="10" fill="#9299a5">
              {Math.round((top * (4 - n)) / 4)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = 57 + i * 80;
          const h = (p.total / top) * 152;
          const fh = (p.failed / top) * 152;
          return (
            <g key={i}>
              <title>
                {p.date.toLocaleDateString()}: {p.total} tool calls, {p.failed} failed
              </title>
              <rect x={x} y={167 - h} width="32" height={h} rx="4" fill="#9fcebb" />
              <rect x={x} y={167 - fh} width="32" height={fh} rx="3" fill="#eab28a" />
              <text x={x + 16} y="192" textAnchor="middle" fontSize="10" fill="#828995">
                {p.date.toLocaleDateString(undefined, { weekday: 'short' })} {p.date.getDate()}
              </text>
            </g>
          );
        })}
      </svg>
      <span className="chart-caption">
        Daily detail · latest 7 calendar days in view; summary cards include the full selected
        period.
      </span>
    </div>
  );
}
function OutcomeChart({ sessions }: { sessions: Session[] }) {
  const total = sessions.length;
  const counts = Object.keys(outcomeLabels).map((k) => ({
    key: k,
    label: outcomeLabels[k as Outcome],
    count: sessions.filter((s) => s.outcome === k).length,
  }));
  const colors: Record<string, string> = {
    shipped: '#78ac96',
    'needs-work': '#eab28a',
    abandoned: '#a1a6be',
    unreviewed: '#e9edf1',
  };
  let offset = 0;
  return (
    <div className="outcome-content">
      <div className="donut">
        <svg viewBox="0 0 120 120" role="img" aria-label={`Outcomes for ${total} sessions`}>
          <circle cx="60" cy="60" r="45" fill="none" stroke="#edf0f2" strokeWidth="12" />
          {counts.map((c) => {
            const length = total ? (c.count / total) * 282.743 : 0;
            const start = offset;
            offset += length;
            return (
              <circle
                key={c.key}
                cx="60"
                cy="60"
                r="45"
                fill="none"
                stroke={colors[c.key]}
                strokeWidth="12"
                strokeDasharray={`${length} ${282.743 - length}`}
                strokeDashoffset={-start}
                transform="rotate(-90 60 60)"
              />
            );
          })}
        </svg>
        <div>
          <strong>{total}</strong>
          <span>sessions</span>
        </div>
      </div>
      <div className="outcome-legend">
        {counts.map((c) => (
          <div key={c.key}>
            <span>
              <i style={{ background: colors[c.key] }} />
              {c.label}
            </span>
            <strong>{c.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
function SessionList({
  sessions,
  onOpen,
  compact = false,
}: {
  sessions: Session[];
  onOpen: (s: Session) => void;
  compact?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className={cls('session-table', compact && 'compact')}>
        <thead>
          <tr>
            <th>Session</th>
            <th>Engineer</th>
            {!compact && <th>Activity est.</th>}
            <th>Outcome</th>
            {!compact && <th>Findings</th>}
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} onClick={() => onOpen(s)}>
              <td>
                <button
                  className="session-title"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(s);
                  }}
                >
                  <span className={cls('provider-mark', s.provider === 'Claude Code' && 'claude')}>
                    <Command size={15} />
                  </span>
                  <span>
                    <strong>{s.title}</strong>
                    <small>
                      {s.project}
                      <span>·</span>
                      {s.provider}
                      <span>·</span>
                      {dateLabel(s.startedAt)}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <div className="person">
                  <span className={`avatar member-${s.engineer.length % 4}`}>
                    {initials(s.engineer)}
                  </span>
                  <span>{compact ? s.engineer.split(' ')[0] : s.engineer}</span>
                </div>
              </td>
              {!compact && <td className="mono muted">{duration(metrics(s).activeMinutes)}</td>}
              <td>
                <span className={`status ${s.outcome}`}>
                  <i />
                  {outcomeLabels[s.outcome]}
                </span>
              </td>
              {!compact && (
                <td>
                  <span className={cls('finding-count', findings(s).length > 0 && 'has-findings')}>
                    {findings(s).length}
                  </span>
                </td>
              )}
              <td>
                <ChevronRight size={15} className="muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({
  onImport,
  mode,
  onClear,
}: {
  onImport: () => void;
  mode: string;
  onClear?: () => void;
}) {
  return (
    <div className="empty-state">
      <Terminal size={32} />
      <h2>{onClear ? 'No sessions match your filters' : 'Your next session starts here'}</h2>
      <p>
        {onClear
          ? 'Broaden your filters to see more of your workspace.'
          : mode === 'live'
            ? 'Import a Codex or Claude Code export to explore your own workflow.'
            : 'No demo sessions are in this view.'}
      </p>
      <button className="button primary" onClick={onClear || onImport}>
        {onClear ? 'Clear filters' : 'Import a session'}
      </button>
    </div>
  );
}
function groupFindings(fs: Finding[]) {
  return fs.reduce<Record<string, Finding[]>>((a, f) => {
    (a[f.rule] ||= []).push(f);
    return a;
  }, {});
}
function FindingCard({
  finding: f,
  session: s,
  decision,
  onEvidence,
  onDecide,
  disabled,
  proposal,
  improvement,
  sessions,
  onApply,
  onSource,
}: {
  finding: Finding;
  session: Session;
  decision?: Decision;
  onEvidence: () => void;
  onDecide: (v: Decision, content?: string) => void;
  disabled: boolean;
  proposal: FixProposal;
  improvement?: Improvement;
  sessions: Session[];
  onApply: () => Promise<void>;
  onSource: (sessionId: string, eventId: string) => void;
}) {
  return (
    <article className="card finding-card">
      <div className={cls('rule-icon', f.severity)}>
        {f.rule === 'environment' ? (
          <Terminal size={20} />
        ) : f.rule === 'retry-loop' ? (
          <Activity size={20} />
        ) : (
          <BookOpen size={20} />
        )}
      </div>
      <div className="finding-body">
        <div className="finding-heading">
          <h2>{f.title}</h2>
          <span className={cls('priority', f.severity)}>
            {f.severity === 'high'
              ? 'Investigate'
              : f.severity === 'medium'
                ? 'Review context'
                : 'Check verification'}
          </span>
          {decision && (
            <span className="decision-chip">
              {decision === 'accepted' ? <Check size={13} /> : <X size={13} />} {decision}
            </span>
          )}
        </div>
        <p>{f.description}</p>
        <div className="finding-meta">
          <span className="project-tag">{s.project}</span>
          <span>{s.engineer}</span>
          <span>·</span>
          <span>{s.title}</span>
        </div>
        <div className="suggestion">
          <span className="suggestion-label">
            <Sparkles size={14} />
            Suggested next step
          </span>
          <p>{f.action}</p>
          <FixReview
            proposal={proposal}
            improvement={improvement}
            sessions={sessions}
            accepted={decision === 'accepted'}
            busy={disabled}
            onAccept={(content) => onDecide('accepted', content)}
            onApply={onApply}
            onSource={onSource}
          />
        </div>
        <div className="finding-actions">
          <button className="text-button" onClick={onEvidence}>
            Inspect {f.evidence.length} source events <ArrowRight size={14} />
          </button>
          <div>
            <button
              className="button small-button secondary"
              disabled={disabled || decision === 'dismissed'}
              onClick={() => onDecide('dismissed')}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const el = ref.current;
    el?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const nodes = el?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href],summary,[tabindex="0"]',
        );
        if (!nodes?.length) {
          e.preventDefault();
          return;
        }
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || document.activeElement === el)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = overflow;
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cls('modal', wide && 'wide')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function SessionDetail({
  session: s,
  evidence,
  onClose,
  onSave,
  onDelete,
}: {
  session: Session;
  evidence: string | null;
  onClose: () => void;
  onSave: (b: unknown) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [tab, setTab] = useState('timeline');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [notes, setNotes] = useState(s.notes);
  const [person, setPerson] = useState(s.engineer);
  const [outcome, setOutcome] = useState(s.outcome);
  const [url, setUrl] = useState(s.prUrl);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const m = metrics(s);
  useEffect(() => {
    if (evidence)
      setTimeout(
        () =>
          document
            .getElementById(`event-${evidence}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        150,
      );
  }, [evidence]);
  const events = s.events.filter(
    (e) =>
      (kind === 'all' || e.kind === kind) &&
      (!query ||
        [e.text, e.command, e.output].join(' ').toLowerCase().includes(query.toLowerCase())),
  );
  return (
    <Modal title="Session detail" onClose={onClose} wide>
      <div className="detail-intro">
        <div className="detail-meta">
          <span className="project-tag">{s.project}</span>
          <span>{s.provider}</span>
          <span>·</span>
          <span>{s.model}</span>
          {s.demo && <span className="demo-chip">Synthetic</span>}
          {s.syncSource && <span className="demo-chip">Auto-synced</span>}
        </div>
        <h2>{s.title}</h2>
        <p>
          {s.engineer} ·{' '}
          {dateLabel(s.startedAt, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
        <div className="detail-stats">
          <span>
            <Clock3 size={15} />
            <strong>{duration(m.activeMinutes)}</strong> estimated activity
          </span>
          <span>
            <Terminal size={15} />
            <strong>{m.tools}</strong> tool calls
          </span>
          <span className={m.failures ? 'failure-text' : ''}>
            <Activity size={15} />
            <strong>{m.failures}</strong> failures
          </span>
        </div>
      </div>
      <div className="tabs detail-tabs">
        {[
          ['timeline', 'Event timeline'],
          ['review', 'Outcome & notes'],
          ['findings', 'Findings'],
        ].map(([v, l]) => (
          <button key={v} className={cls(tab === v && 'active')} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
      </div>
      <div className="detail-scroll">
        {tab === 'timeline' && (
          <>
            <div className="timeline-filters">
              <SearchField value={query} onChange={setQuery} placeholder="Search event text…" />
              <Select
                label="Event type"
                value={kind}
                onChange={setKind}
                options={[
                  ['all', 'All events'],
                  ['prompt', 'Prompts'],
                  ['response', 'Responses'],
                  ['tool', 'Tools'],
                ]}
              />
            </div>
            <div className="timeline">
              {events.map((e) => (
                <EventRow event={e} highlight={e.id === evidence} key={e.id} />
              ))}
              {!events.length && <p className="quiet-state">No events match your search.</p>}
            </div>
          </>
        )}
        {tab === 'review' && (
          <form
            className="review-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              setErr('');
              try {
                await onSave({ notes, engineer: person, outcome, prUrl: url });
                setSaved(true);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className="form-note">
              <HelpCircle size={16} />
              Only you can confirm the outcome. Agent statements do not establish that a change
              shipped.
            </div>
            <div className="form-grid">
              <label>
                Engineer
                <input
                  value={person}
                  onChange={(e) => {
                    setPerson(e.target.value);
                    setSaved(false);
                  }}
                  required
                  maxLength={100}
                />
              </label>
              <label>
                Reported outcome
                <select
                  value={outcome}
                  onChange={(e) => {
                    setOutcome(e.target.value as Outcome);
                    setSaved(false);
                  }}
                >
                  {Object.entries(outcomeLabels).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Pull request URL <span className="muted">(optional)</span>
              <input
                type="url"
                placeholder="https://github.com/team/repo/pull/123"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setSaved(false);
                }}
              />
              {s.prUrl && /^https?:\/\//i.test(s.prUrl) && (
                <a className="text-button" href={s.prUrl} target="_blank" rel="noreferrer">
                  Open linked PR <ExternalLink size={13} />
                </a>
              )}
            </label>
            <label>
              Review notes
              <textarea
                rows={6}
                placeholder="What worked? What needed intervention? How was this verified?"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setSaved(false);
                }}
                maxLength={10000}
              />
            </label>
            {err && (
              <p className="form-error" role="alert">
                {err}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button danger"
                type="button"
                disabled={saving}
                onClick={async () => {
                  if (confirm('Delete this session and its recommendation decisions?')) {
                    setSaving(true);
                    try {
                      await onDelete();
                    } catch (e) {
                      setErr((e as Error).message);
                      setSaving(false);
                    }
                  }
                }}
              >
                <Trash2 size={15} />
                Delete session
              </button>
              <button className="button primary" disabled={saving}>
                {saving ? (
                  <Loader2 size={15} className="spin" />
                ) : saved ? (
                  <Check size={15} />
                ) : null}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save review'}
              </button>
            </div>
          </form>
        )}
        {tab === 'findings' && (
          <div className="session-findings">
            {findings(s).map((f) => (
              <div className="session-finding" key={f.id}>
                <h3>{f.title}</h3>
                <p>{f.description}</p>
                <strong>Next step</strong>
                <p>{f.action}</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setTab('timeline');
                    setKind('all');
                    setQuery('');
                    setTimeout(
                      () =>
                        document
                          .getElementById(`event-${f.evidence[0]}`)
                          ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
                      80,
                    );
                  }}
                >
                  Inspect source event <ArrowRight size={14} />
                </button>
              </div>
            ))}
            {!findings(s).length && (
              <div className="empty-state">
                <CheckCircle2 size={30} />
                <h2>No rule matches</h2>
                <p>
                  This is not a guarantee of correctness. The current rules found no matching
                  patterns.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="detail-footer">
        <ShieldCheck size={13} />
        Stored locally · Source ID: <span>{s.sourceId}</span>
      </div>
    </Modal>
  );
}
function EventRow({ event: e, highlight }: { event: SessionEvent; highlight: boolean }) {
  const [expanded, setExpanded] = useState(highlight || e.failed || false);
  return (
    <article
      id={`event-${e.id}`}
      className={cls('event', highlight && 'highlight', e.failed && 'failed')}
    >
      <div className="event-dot">
        {e.kind === 'tool' ? (
          <Terminal size={14} />
        ) : e.kind === 'prompt' ? (
          <Command size={14} />
        ) : (
          <Sparkles size={14} />
        )}
      </div>
      <div className="event-content">
        <div className="event-heading">
          <strong>{e.kind === 'tool' ? e.tool : e.kind === 'prompt' ? 'Engineer' : 'Agent'}</strong>
          {e.failed && <span className="event-failure">Failed</span>}
          <span className="event-id">{e.id}</span>
          <time>
            {e.timestamp
              ? new Date(e.timestamp).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : 'No timestamp'}
          </time>
        </div>
        {e.kind === 'tool' ? (
          <>
            <pre className="command">{e.command || e.text}</pre>
            {e.output && (
              <>
                <button
                  className="text-button output-toggle"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? 'Hide' : 'Show'} output <ChevronDown size={12} />
                </button>
                {expanded && <pre className="tool-output">{e.output}</pre>}
              </>
            )}
          </>
        ) : (
          <p className="event-text">{e.text}</p>
        )}
      </div>
    </article>
  );
}
function ImportModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (
    f: { name: string; content: string }[],
    person: string,
  ) => Promise<{ imported: number; duplicates: number; errors: string[] }>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [engineer, setEngineer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    duplicates: number;
    errors: string[];
  } | null>(null);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  function choose(list: File[]) {
    setResult(null);
    setErr('');
    if (list.length > 30) {
      setErr('Select at most 30 files.');
      return;
    }
    if (list.reduce((a, f) => a + f.size, 0) > 20 * 1024 * 1024) {
      setErr('Select up to 20 MB total.');
      return;
    }
    setFiles(list);
  }
  return (
    <Modal title="Import agent sessions" onClose={onClose}>
      <div className="modal-body">
        <p className="modal-description">
          Bring your own traces. Tracework analyzes them on this machine, with no external API
          calls.
        </p>
        <div
          role="button"
          tabIndex={0}
          className={cls('dropzone', drag && 'dragging')}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            choose(Array.from(e.dataTransfer.files));
          }}
        >
          <span className="upload-icon">
            <Upload size={25} />
          </span>
          <strong>Drop session files here</strong>
          <span>or click to browse your files</span>
          <small>Codex / Claude Code JSONL · Tracework JSON · 20 MB total</small>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            multiple
            accept=".json,.jsonl"
            onChange={(e) => choose(Array.from(e.target.files || []))}
            aria-label="Choose session files"
          />
        </div>
        {files.length > 0 && (
          <div className="selected-files">
            {files.map((f, i) => (
              <div key={i}>
                <FileJson size={16} />
                <span>{f.name}</span>
                <small>{(f.size / 1024).toFixed(1)} KB</small>
                <button
                  className="icon-button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="form-label">
          Assign engineer
          <input
            placeholder="e.g. Your name"
            value={engineer}
            onChange={(e) => setEngineer(e.target.value)}
            maxLength={100}
          />
          <small>Optional. You can update this later in the session review.</small>
        </label>
        <div className="import-help">
          <strong>
            <FileJson size={15} />
            Where to find exports
          </strong>
          <p>
            Codex: select a JSONL file from your sessions directory.
            <br />
            Claude Code: select a conversation JSONL from your projects directory.
          </p>
          <p>
            Files are read only when you choose them. Common secret patterns are redacted; review
            sensitive content before importing.
          </p>
          <a href="/sample-session.json" download className="text-button">
            Download a sample JSON file <ArrowDownToLine size={13} />
          </a>
        </div>
        {err && (
          <p className="form-error" role="alert">
            {err}
          </p>
        )}
        {result && (
          <div
            className={cls('import-result', result.errors.length > 0 && 'with-errors')}
            role="status"
          >
            <strong>
              {result.imported} imported · {result.duplicates} duplicates skipped
            </strong>
            {result.errors.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
            {!result.errors.length && <p>Your sessions are ready in My data.</p>}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          {result ? 'Done' : 'Cancel'}
        </button>
        <button
          className="button primary"
          disabled={!files.length || busy}
          onClick={async () => {
            setBusy(true);
            setErr('');
            try {
              const read = await Promise.all(
                files.map(async (f) => ({ name: f.name, content: await f.text() })),
              );
              setResult(await onImport(read, engineer));
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}{' '}
          {busy ? 'Analyzing…' : 'Import & analyze'}
        </button>
      </div>
    </Modal>
  );
}
function WorkModal({
  members,
  projects,
  onClose,
  onSave,
}: {
  members: string[];
  projects: string[];
  onClose: () => void;
  onSave: (v: unknown) => Promise<void>;
}) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Log engineering time" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setErr('');
          try {
            await onSave({ ...Object.fromEntries(f), minutes: Number(f.get('minutes')) });
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body">
          <p className="modal-description">
            Capture work outside agent sessions. These entries are reported separately from
            estimated activity.
          </p>
          <div className="form-grid">
            <label>
              Engineer
              <input
                name="engineer"
                list="members"
                required
                maxLength={100}
                placeholder="Your name"
              />
              <datalist id="members">
                {members.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </datalist>
            </label>
            <label>
              Project
              <input
                name="project"
                list="projects"
                required
                maxLength={100}
                placeholder="Project name"
              />
              <datalist id="projects">
                {projects.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </datalist>
            </label>
            <label>
              Category
              <select name="category">
                {[
                  'Code review',
                  'Planning',
                  'Debugging',
                  'Implementation',
                  'Meetings',
                  'Other',
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Duration (minutes)
              <input
                name="minutes"
                type="number"
                min={1}
                max={1440}
                step={1}
                required
                defaultValue={30}
              />
            </label>
            <label>
              Date
              <input name="date" type="date" required defaultValue={localDate()} />
            </label>
          </div>
          <label>
            Note
            <textarea name="note" rows={3} maxLength={2000} placeholder="What did you work on?" />
          </label>
          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function MethodModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Understand the measurements" onClose={onClose}>
      <div className="modal-body methodology">
        <div className="form-note">
          <ShieldCheck size={20} />
          <span>
            Tracework is a local, single-user prototype. No analytics, cloud sync, or automatic
            access to your repositories.
          </span>
        </div>
        <h3>Observed activity ≠ hours worked</h3>
        <p>
          We sum gaps between timestamped events and cap each gap at five minutes. An isolated event
          contributes no time. This is an approximate interaction footprint, not labor, focus time,
          or productivity.
        </p>
        <h3>Outcomes come from you</h3>
        <p>
          Imported sessions start unreviewed. Shipped, needs work, and abandoned are human-reported
          labels. A successful test or an agent saying “done” does not prove delivery.
        </p>
        <h3>Four transparent analysis rules</h3>
        <ul>
          <li>
            <strong>Failure loop:</strong> an identical command fails at least three times.
          </li>
          <li>
            <strong>Environment:</strong> a failed tool result contains a recognized missing
            dependency or connection error.
          </li>
          <li>
            <strong>Recurring context:</strong> an identical discovery command appears at least four
            times.
          </li>
          <li>
            <strong>Verification:</strong> edits are observed with no recognized successful test,
            check, or build command.
          </li>
        </ul>
        <p>
          Tool failures use explicit flags, nonzero exit codes, and specific error signatures.
          Missing output is not proof of success. Findings are heuristics and may need correction.
        </p>
        <h3>Your files stay here</h3>
        <p>
          Files are imported manually or collected from directories you explicitly connect. Common
          token and password patterns are redacted before storage, but redaction cannot guarantee
          that all confidential content is removed. Data lives in the project’s local SQLite
          database. Demo data is synthetic and separate.
        </p>
        <h3>What this version doesn’t infer</h3>
        <p>
          No employee rankings, model cost estimates, causal productivity claims, or time-saved
          estimates. PR links are annotations; they aren’t live GitHub verification.
        </p>
        <h3>Supported inputs</h3>
        <p>
          Codex response_item JSONL, Claude Code conversation JSONL, and the downloadable Tracework
          JSON schema. Export formats evolve; unsupported events may be omitted.
        </p>
      </div>
      <div className="modal-footer">
        <button className="button primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
