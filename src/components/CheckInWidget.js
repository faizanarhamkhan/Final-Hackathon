'use client';

import { useEffect, useState } from 'react';
import { Camera, LogIn, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { Button, Card, ErrorBox, Loading, StatusBadge, useToast } from './ui';
import { CameraCheckIn } from './CameraCheckIn';

function useClock(serverTime) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    if (!serverTime) return;
    // Show the company-time clock, ticking from the server's time.
    const [h, m, s] = serverTime.split(':').map(Number);
    const startServer = h * 3600 + m * 60 + s;
    const startLocal = Date.now();
    const tick = () => {
      const t = (startServer + Math.floor((Date.now() - startLocal) / 1000)) % 86400;
      setNow(`${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverTime]);
  return now;
}

export function CheckInWidget({ onChange }) {
  const toast = useToast();
  const today = useApi('attendance/today');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [camera, setCamera] = useState(null);
  const clock = useClock(today.data?.server_time);

  async function act(kind) {
    setBusy(true);
    setError(null);
    try {
      const r = await api(kind === 'in' ? 'attendance/check-in' : 'attendance/check-out', { method: 'POST', body: { source: 'web' } });
      toast(kind === 'in' ? `Checked in at ${fmtTime(r.check_in)} (${r.status.replace('_', ' ')})` : `Checked out at ${fmtTime(r.check_out)}`);
      today.reload();
      onChange?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (today.loading && !today.data) return <Card title="Today"><Loading /></Card>;
  if (today.error) return <Card title="Today"><ErrorBox error={today.error} onRetry={today.reload} /></Card>;
  const t = today.data;
  const rec = t.record;
  return (
    <Card title="Today" actions={rec && <StatusBadge status={rec.status} />}>
      <div className="checkin">
        <div>
          <div className="clock">{clock || '--:--:--'}</div>
          <div className="muted">
            {t.date} · office starts {t.office_start}, grace {t.grace_minutes} min{!t.working_day ? ` · ${t.holiday || 'weekend'}` : ''}
          </div>
        </div>
        {rec && (
          <div className="row">
            <span>In: <strong>{fmtTime(rec.check_in)}</strong></span>
            <span>Out: <strong>{fmtTime(rec.check_out)}</strong></span>
            {rec.hours != null && <span>{rec.hours} h</span>}
            {rec.source !== 'web' && <span className="badge blue">{rec.source}</span>}
          </div>
        )}
        <ErrorBox error={error} />
        <div className="row">
          {!rec && (
            <Button variant="primary" size="lg" loading={busy} onClick={() => act('in')}>
              <LogIn size={17} /> Check in
            </Button>
          )}
          {rec && !rec.check_out && (
            <Button variant="primary" size="lg" loading={busy} onClick={() => act('out')}>
              <LogOut size={17} /> Check out
            </Button>
          )}
          {t.camera_enabled && (!rec || !rec.check_out) && (
            <Button size="lg" onClick={() => setCamera(rec ? 'out' : 'in')}>
              <Camera size={17} /> Camera check-{rec ? 'out' : 'in'}
            </Button>
          )}
          {rec?.check_out && <span className="muted">Done for today. See you tomorrow!</span>}
        </div>
        <small>The server records the time, not your device.</small>
      </div>
      <CameraCheckIn
        open={!!camera}
        mode={camera || 'in'}
        onClose={() => setCamera(null)}
        onDone={(r) => {
          toast(`Camera check-${camera} recorded (${r.distance_m != null ? `${Math.round(r.distance_m)} m from office` : r.status})`);
          today.reload();
          onChange?.();
        }}
      />
    </Card>
  );
}
