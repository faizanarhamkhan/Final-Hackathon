'use client';

import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { RequireRole } from '@/components/AppShell';
import { Async, Button, Card, Field, Input, Modal, PageHeader, Select, Table, Tabs } from '@/components/ui';

function AuditLog() {
  const [filters, setFilters] = useState({ entity: '', action: '', from: '', to: '', page: 1 });
  const state = useApi('audit', { ...filters, pageSize: 25 });
  const [open, setOpen] = useState(null);
  const d = state.data;
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  return (
    <>
      <div className="card card-body filters" style={{ marginBottom: 16 }}>
        <Field label="Entity">
          <Select value={filters.entity} onChange={set('entity')}>
            <option value="">All</option>
            {(d?.entities || []).map((e) => <option key={e}>{e}</option>)}
          </Select>
        </Field>
        <Field label="Action contains"><Input value={filters.action} onChange={set('action')} placeholder="approve, finalize…" /></Field>
        <Field label="From"><Input type="date" value={filters.from} onChange={set('from')} /></Field>
        <Field label="To"><Input type="date" value={filters.to} onChange={set('to')} /></Field>
      </div>
      <Card tight title={d ? `${d.total} entries` : 'Entries'}>
        <Async state={state}>
          {d && (
            <>
              <Table
                rows={d.rows}
                onRowClick={setOpen}
                columns={[
                  { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
                  { key: 'actor_name', label: 'Actor', render: (r) => <>{r.actor_name} <span className={`role-pill role-${r.actor_role}`}>{r.actor_role}</span></> },
                  { key: 'action', label: 'Action', render: (r) => <code>{r.action}</code> },
                  { key: 'entity', label: 'Entity', render: (r) => `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` },
                  { key: 'ip', label: 'IP' },
                ]}
              />
              {d.pages > 1 && (
                <div className="row" style={{ justifyContent: 'flex-end', padding: 12 }}>
                  <Button size="sm" disabled={d.page <= 1} onClick={() => setFilters({ ...filters, page: d.page - 1 })}>Previous</Button>
                  <span className="muted">Page {d.page} of {d.pages}</span>
                  <Button size="sm" disabled={d.page >= d.pages} onClick={() => setFilters({ ...filters, page: d.page + 1 })}>Next</Button>
                </div>
              )}
            </>
          )}
        </Async>
      </Card>
      <Modal open={!!open} wide title={open ? `${open.action} · ${fmtDateTime(open.created_at)}` : ''} onClose={() => setOpen(null)}>
        {open && (
          <div className="grid grid-2">
            <div><h3 style={{ marginBottom: 6 }}>Before</h3><pre className="json">{open.before ? JSON.stringify(open.before, null, 2) : '—'}</pre></div>
            <div><h3 style={{ marginBottom: 6 }}>After</h3><pre className="json">{open.after ? JSON.stringify(open.after, null, 2) : '—'}</pre></div>
          </div>
        )}
      </Modal>
    </>
  );
}

function AiLogs() {
  const state = useApi('ai/logs', { limit: 100 });
  return (
    <Card tight title="Assistant calls (ai_logs)">
      <Async state={state}>
        <Table
          rows={state.data}
          empty="No assistant calls yet"
          columns={[
            { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
            { key: 'user_name', label: 'User', render: (r) => <>{r.user_name} <span className={`role-pill role-${r.role}`}>{r.role}</span></> },
            { key: 'feature', label: 'Feature' },
            { key: 'prompt', label: 'Prompt', render: (r) => <span style={{ display: 'inline-block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.prompt}</span> },
            { key: 'provider', label: 'Provider' },
            { key: 'status', label: 'Status' },
            { key: 'latency_ms', label: 'ms', num: true },
          ]}
        />
      </Async>
    </Card>
  );
}

export default function Page() {
  const [tab, setTab] = useState('audit');
  return (
    <RequireRole roles={['admin']}>
      <PageHeader title="Audit log" subtitle="Every important action with actor, entity and before/after values. Entries cannot be changed or deleted." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'audit', label: 'Audit log' }, { value: 'ai', label: 'AI logs' }]} />
      {tab === 'audit' ? <AuditLog /> : <AiLogs />}
    </RequireRole>
  );
}
