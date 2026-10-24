'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from './ui';

// Leave application form. `draft` pre-fills it (from smart leave or the chat); the user confirms.
export function LeaveForm({ open, onClose, draft, warnings = [], onSaved }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [form, setForm] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError(null);
    Promise.all([api('org/leave-types'), api('leave/balance')])
      .then(([t, b]) => {
        const active = t.filter((x) => x.is_active);
        setTypes(active);
        setBalances(b);
        setForm({
          leave_type_id: draft?.leave_type_id || active.find((x) => x.code === 'casual')?.id || active[0]?.id || '',
          start_date: draft?.start_date || '',
          end_date: draft?.end_date || '',
          reason: draft?.reason || '',
        });
      })
      .catch(setError);
  }, [open, draft]);

  const bal = balances.find((b) => b.leave_type_id === Number(form.leave_type_id));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value, ...(k === 'start_date' && (!form.end_date || form.end_date < e.target.value) ? { end_date: e.target.value } : {}) });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api('leave/requests', { method: 'POST', body: { ...form, leave_type_id: Number(form.leave_type_id), source: draft ? 'ai' : 'form' } });
      toast('Leave request sent to HR');
      onSaved?.();
      onClose();
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft ? 'Review your leave request' : 'Apply for leave'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {draft ? 'Confirm and submit' : 'Submit request'}
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        {draft && (
          <div className="alert alert-info">
            <Sparkles size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <span className="ai-label">AI-generated</span> The assistant filled this form from your message. Check the dates and type, then confirm. Nothing is saved until you submit.
            </div>
          </div>
        )}
        {warnings.length > 0 && <div className="alert alert-warn">{warnings.join(' ')}</div>}
        <ErrorBox error={error} />
        <Field label="Leave type" error={errors.leave_type_id} hint={bal ? (bal.quota == null ? 'Unlimited' : `${bal.available} day(s) available (${bal.used} used, ${bal.pending} pending of ${bal.quota})`) : null}>
          <Select value={form.leave_type_id} onChange={set('leave_type_id')} invalid={!!errors.leave_type_id}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="form-grid">
          <Field label="From" error={errors.start_date}>
            <Input type="date" value={form.start_date} onChange={set('start_date')} required invalid={!!errors.start_date} />
          </Field>
          <Field label="To" error={errors.end_date}>
            <Input type="date" value={form.end_date} min={form.start_date} onChange={set('end_date')} required invalid={!!errors.end_date} />
          </Field>
        </div>
        <Field label="Reason" error={errors.reason}>
          <Textarea value={form.reason} onChange={set('reason')} required maxLength={500} />
        </Field>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Only working days count. Weekends and public holidays are skipped automatically.
        </p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
