'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { Async, Button, Card, Empty, ErrorBox, Field, Input, PageHeader, Textarea, useToast } from '@/components/ui';

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canPost = user.role !== 'employee';
  const state = useApi('announcements', { limit: 50 });
  const [form, setForm] = useState({ title: '', body: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function post(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api('announcements', { method: 'POST', body: form });
      setForm({ title: '', body: '' });
      toast('Announcement posted to everyone');
      state.reload();
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Announcements" subtitle={canPost ? 'Post news to every dashboard. Everyone gets a notification.' : 'News from Admin and HR'} />
      <div className={canPost ? 'grid grid-2' : 'stack'} style={{ alignItems: 'start' }}>
        {canPost && (
          <Card title="New announcement">
            <form className="stack" onSubmit={post}>
              <ErrorBox error={error} />
              <Field label="Title" error={errors.title}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Message" error={errors.body}><Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ minHeight: 120 }} /></Field>
              <div><Button variant="primary" loading={busy} type="submit">Post</Button></div>
            </form>
          </Card>
        )}
        <Card title="Latest">
          <Async state={state}>
            {!state.data?.length ? (
              <Empty title="No announcements yet" />
            ) : (
              <div className="stack">
                {state.data.map((a) => (
                  <div key={a.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{a.title}</strong>
                      {(user.role === 'admin' || a.author_id === user.id) && (
                        <Button size="sm" variant="ghost" className="icon-btn" aria-label="Delete" title="Delete" onClick={() => window.confirm('Delete this announcement?') && api(`announcements/${a.id}`, { method: 'DELETE' }).then(state.reload).catch((e) => toast(e.message, 'error'))}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                    <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{a.body}</p>
                    <small>{a.author_name} ({a.author_role}) · {fmtDateTime(a.created_at)}</small>
                  </div>
                ))}
              </div>
            )}
          </Async>
        </Card>
      </div>
    </>
  );
}
