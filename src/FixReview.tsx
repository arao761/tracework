import { useState } from 'react';
import { recurrence } from '../shared/improvements';
import type { FixProposal, Improvement, Session } from '../shared/model';

export default function FixReview({
  proposal,
  improvement,
  sessions,
  accepted,
  busy,
  onAccept,
  onApply,
  onSource,
}: {
  proposal: FixProposal;
  improvement?: Improvement;
  sessions: Session[];
  accepted: boolean;
  busy: boolean;
  onAccept: (content: string) => void;
  onApply: () => Promise<void>;
  onSource: (sessionId: string, eventId: string) => void;
}) {
  const [content, setContent] = useState(proposal.content);
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const followup = improvement ? recurrence(improvement, sessions) : null;
  const reviewed = improvement?.proposal || proposal;
  const text = improvement ? reviewed.content : content;
  return (
    <section className="fix-review">
      <details>
        <summary>
          Review proposed fix · {reviewed.sources.length} supporting session
          {reviewed.sources.length === 1 ? '' : 's'}
        </summary>
        <p>{reviewed.rationale}</p>
        <p>
          <strong>Proposed change:</strong> append to <code>{reviewed.target}</code> in this
          project. Keep existing instructions and adapt this section before applying.
        </p>
        <label>
          Repository instruction
          <textarea
            aria-label="Proposed repository instruction"
            rows={7}
            maxLength={6000}
            value={text}
            readOnly={!!improvement}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <div className="fix-buttons">
          <button
            className="button secondary small-button"
            onClick={async () => {
              try {
                if (window.traceworkDesktop) await window.traceworkDesktop.copyText(text);
                else await navigator.clipboard.writeText(text);
                setMessage(
                  `Copied. Append it to ${reviewed.target} after reviewing the repository.`,
                );
              } catch {
                setMessage('Select the text above to copy it manually.');
              }
            }}
          >
            Copy reviewed change
          </button>
          <button
            className="button secondary small-button"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = 'tracework-instruction.md';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              setMessage(
                `Downloaded an instruction snippet. Append it to ${reviewed.target}; do not replace the file.`,
              );
            }}
          >
            Download snippet
          </button>
        </div>
        <p className="muted">
          Tracework does not write repository files. Acceptance saves the proposal; apply the
          reviewed text in your editor.
        </p>
        <ul className="fix-sources">
          {reviewed.sources.map((source) => (
            <li key={source.sessionId}>
              <button
                className="text-button"
                onClick={() => onSource(source.sessionId, source.evidence[0])}
              >
                {source.title} · {source.evidence.length} evidence events
              </button>
            </li>
          ))}
        </ul>
      </details>
      {message && <p role="status">{message}</p>}
      {(!improvement || !accepted) && (
        <button
          className="button small-button primary"
          disabled={busy || !content.trim()}
          onClick={() => onAccept(content)}
        >
          {improvement
            ? 'Reopen accepted proposal'
            : accepted
              ? 'Start follow-up tracking'
              : 'Accept proposal & track'}
        </button>
      )}
      {improvement && followup && (
        <div className="fix-followup">
          <h3>
            {improvement.appliedAt ? 'Follow-up after application' : 'Follow-up after acceptance'}
          </h3>
          <p>
            Accepted {new Date(improvement.acceptedAt).toLocaleString()}.{' '}
            {improvement.appliedAt
              ? `Marked applied ${new Date(improvement.appliedAt).toLocaleString()}.`
              : 'Application has not been confirmed.'}
          </p>
          <strong>
            {followup.observed === 0
              ? 'Waiting for later sessions'
              : `${followup.matches.length} of ${followup.observed} later sessions show the same pattern`}
          </strong>
          <p>
            Same project, started after {new Date(followup.since).toLocaleString()}, with observed
            tool events. {followup.undated} undated sessions and {followup.withoutTools} later
            sessions without tools excluded. Existing sessions are excluded even if their files
            change.
          </p>
          <p className="muted">
            No recurrence in these sessions does not establish that the change worked. Task mix,
            incomplete exports, and work outside the agent affect observations.
          </p>
          {followup.matches.map((match) => (
            <div key={match.sessionId}>
              <button
                className="text-button"
                onClick={() => onSource(match.sessionId, match.evidence[0])}
              >
                {match.title} · {match.evidence.length} matching event
                {match.evidence.length === 1 ? '' : 's'}
              </button>
            </div>
          ))}
          {!improvement.appliedAt && accepted && (
            <div className="apply-confirmation">
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{' '}
                I reviewed and applied this change in the repository.
              </label>
              <button
                className="button secondary small-button"
                disabled={busy || !confirmed}
                onClick={async () => {
                  try {
                    await onApply();
                    setConfirmed(false);
                  } catch {
                    /* Parent displays request errors. */
                  }
                }}
              >
                Mark applied & start a new observation window
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
