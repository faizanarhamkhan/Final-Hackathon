'use client';

import { useState } from 'react';
import { Megaphone, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { Button, Card, Empty, ErrorBox, Field, Input, Select } from './ui';

export function DashboardFilters({ value, onChange }) {
  const depts = useApi('org/departments');
  const [draft, setDraft] = useState(value);
  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  return (
    <form
      className="card card-body filters"
      style={{ marginBottom: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft);
      }}
    >
      <Field label="From">
        <Input type="date" value={draft.from || ''} onChange={set('from')} />
      </Field>
      <Field label="To">
        <Input type="date" value={draft.to || ''} onChange={set('to')} />
      </Field>
      <Field label="Department">
        <Select value={draft.department_id || ''} onChange={set('department_id')}>
          <option value="">All departments</option>
          {(depts.data || []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button variant="primary" type="submit">
        Apply
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setDraft({});
          onChange({});
        }}
      >
        Reset
      </Button>
    </form>
  );
}

// "Summarize": the server recomputes KPIs for these filters and the AI writes 3-5 bullets from them.
export function AiSummary({ filters }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  async function run() {
    setState({ loading: true, data: null, error: null });
    try {
      const body = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      setState({ loading: false, data: await api('ai/summary', { method: 'POST', body }), error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  }
  return (
    <Card
      title={
        <div className="row">
          <Sparkles size={16} color="var(--accent)" />
          <h3>AI summary</h3>
        </div>
      }
      actions={
        <Button variant="accent" size="sm" loading={state.loading} onClick={run}>
          {state.data ? 'Refresh' : 'Summarize'}
        </Button>
      }
    >
      {state.error && <ErrorBox error={state.error} />}
      {!state.data && !state.error && <p className="muted">Click Summarize for 3-5 insights written from the numbers on this dashboard (current filters).</p>}
      {state.data && (
        <div className="stack">
          <ul className="bullets">
            {state.data.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <div className="row" style={{ fontSize: 12 }}>
            <span className="ai-label">AI-generated</span>
            <span className="muted">{state.data.provider === 'llm' ? 'from the KPI numbers only' : 'built-in summary from the KPI numbers'}</span>
            {state.data.notice && <span className="muted">{state.data.notice}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

export function AnnouncementsCard({ items }) {
  return (
    <Card
      title={
        <div className="row">
          <Megaphone size={16} />
          <h3>Announcements</h3>
        </div>
      }
    >
      {!items?.length ? (
        <Empty title="No announcements" />
      ) : (
        <div className="stack">
          {items.map((a) => (
            <div key={a.id}>
              <strong>{a.title}</strong>
              <p style={{ whiteSpace: 'pre-wrap' }}>{a.body}</p>
              <small>
                {a.author_name} · {fmtDateTime(a.created_at)}
              </small>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
