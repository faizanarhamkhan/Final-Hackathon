'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LocateFixed } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/components/AuthProvider';
import { RequireRole } from '@/components/AppShell';
import { Async, Button, Card, ErrorBox, Field, Input, PageHeader, useToast } from '@/components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function SettingsForm() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const params = useSearchParams();
  const state = useApi('settings');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const readOnly = user.role !== 'admin';

  useEffect(() => {
    if (state.data) setForm({ ...state.data, office_lat: state.data.office_lat ?? '', office_lng: state.data.office_lng ?? '' });
  }, [state.data]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, office_lat: p.coords.latitude.toFixed(6), office_lng: p.coords.longitude.toFixed(6) }));
        toast(`Location captured (±${Math.round(p.coords.accuracy)} m)`);
        setLocating(false);
      },
      () => {
        toast('Could not read location', 'error');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const { id, setup_completed_at, updated_at, ...body } = form;
      await api('settings', { method: 'PUT', body });
      toast('Settings saved. New rules apply to new records.');
      state.reload();
      refresh();
    } catch (err) {
      setErrors(err.fieldErrors?.() || {});
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={readOnly ? 'Company rules' : 'Company settings'} subtitle={readOnly ? 'Set by Admin. HR can view but not change these.' : 'Office hours, attendance rules and the office location for camera check-in'} />
      {params.get('welcome') && !readOnly && <div className="alert alert-success" style={{ marginBottom: 16 }}>Company created. Next: check these rules, then add departments in Organization and create an HR login.</div>}
      <Async state={state}>
        {form && (
          <form onSubmit={save} className="stack" style={{ gap: 16 }}>
            <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
              <div className="grid grid-2">
                <Card title="Company">
                  <div className="form-grid">
                    <Field label="Company name" error={errors.company_name} className="full">
                      <Input value={form.company_name} onChange={set('company_name')} />
                    </Field>
                    <Field label="Time zone" error={errors.timezone}>
                      <Input value={form.timezone} onChange={set('timezone')} />
                    </Field>
                    <Field label="Currency" error={errors.currency}>
                      <Input value={form.currency} onChange={set('currency')} />
                    </Field>
                  </div>
                </Card>
                <Card title="Office hours and rules">
                  <div className="form-grid">
                    <Field label="Office start" error={errors.office_start}>
                      <Input type="time" value={form.office_start} onChange={set('office_start')} />
                    </Field>
                    <Field label="Office end" error={errors.office_end}>
                      <Input type="time" value={form.office_end} onChange={set('office_end')} />
                    </Field>
                    <Field label="Grace time (minutes)" error={errors.grace_minutes} hint="Late after start + grace">
                      <Input type="number" min={0} max={180} value={form.grace_minutes} onChange={set('grace_minutes')} />
                    </Field>
                    <Field label="Half day under (hours)" error={errors.half_day_hours}>
                      <Input type="number" step="0.5" min={1} max={12} value={form.half_day_hours} onChange={set('half_day_hours')} />
                    </Field>
                    <Field label="Weekend days" className="full">
                      <div className="row">
                        {DAYS.map((d, i) => (
                          <label key={d} className="check">
                            <input
                              type="checkbox"
                              checked={form.weekend_days.includes(i)}
                              onChange={(e) => setForm({ ...form, weekend_days: e.target.checked ? [...form.weekend_days, i] : form.weekend_days.filter((x) => x !== i) })}
                            />
                            {d}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <label className="check full">
                      <input type="checkbox" checked={!!form.late_penalty_enabled} onChange={set('late_penalty_enabled')} />
                      Late penalty: every 3 late arrivals deduct half a day in payroll
                    </label>
                  </div>
                </Card>
              </div>
              <Card title="Office location (camera attendance)">
                <div className="form-grid">
                  <Field label="Latitude" error={errors.office_lat}>
                    <Input value={form.office_lat} onChange={set('office_lat')} placeholder="24.860700" />
                  </Field>
                  <Field label="Longitude" error={errors.office_lng}>
                    <Input value={form.office_lng} onChange={set('office_lng')} placeholder="67.001100" />
                  </Field>
                  <Field label="Allowed radius (metres)" error={errors.office_radius_m} hint="Check-in is accepted inside this distance">
                    <Input type="number" min={20} max={5000} value={form.office_radius_m} onChange={set('office_radius_m')} />
                  </Field>
                  {!readOnly && (
                    <Field label=" ">
                      <Button type="button" onClick={useMyLocation} loading={locating}>
                        <LocateFixed size={16} /> Use my current location
                      </Button>
                    </Field>
                  )}
                </div>
                <p className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
                  Leave latitude and longitude empty to turn camera attendance off. The server measures the distance with the Haversine formula.
                </p>
              </Card>
            </fieldset>
            <ErrorBox error={error} />
            {!readOnly && (
              <div>
                <Button variant="primary" loading={busy} type="submit">
                  Save settings
                </Button>
              </div>
            )}
          </form>
        )}
      </Async>
    </>
  );
}

export default function SettingsPage() {
  return (
    <RequireRole roles={['admin', 'hr']}>
      <Suspense>
        <SettingsForm />
      </Suspense>
    </RequireRole>
  );
}
