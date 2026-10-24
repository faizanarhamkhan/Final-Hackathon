'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmtPct, fmtTime, monthLabel, STATUS_LABEL } from '@/lib/format';
import { Button } from './ui';

const LEGEND = [
  ['present', 'var(--primary)'],
  ['late', 'var(--warn)'],
  ['half_day', 'var(--accent)'],
  ['missing_checkout', 'var(--info)'],
  ['absent', 'var(--danger)'],
  ['on_leave', 'color-mix(in srgb, var(--accent) 50%, var(--surface))'],
];

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function AttendanceCalendar({ data, month, onMonth, today }) {
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const lead = (first + 6) % 7; // Monday-first grid
  const s = data.summary;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <Button size="sm" className="icon-btn" onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month" title="Previous month"><ChevronLeft size={15} /></Button>
          <strong style={{ minWidth: 120, textAlign: 'center' }}>{monthLabel(month)}</strong>
          <Button size="sm" className="icon-btn" onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month" title="Next month"><ChevronRight size={15} /></Button>
        </div>
        <div className="row" style={{ fontSize: 12.5 }}>
          <span>Rate <strong>{fmtPct(s.attendance_rate)}</strong></span>
          <span>Late <strong>{s.late_arrivals}</strong></span>
          <span>Absent <strong>{s.counts.absent}</strong></span>
          <span>Leave <strong>{s.counts.on_leave}</strong></span>
        </div>
      </div>
      <div className="cal">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="cal-head">{d}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
        {data.days.map((d) => (
          <div key={d.date} className={`cal-day ${d.status} ${d.date === today ? 'today' : ''}`} title={`${d.date}: ${STATUS_LABEL[d.status] || d.status}${d.holiday ? ` (${d.holiday})` : ''}`}>
            <span className="d">{Number(d.date.slice(8))}</span>
            <span className="lbl">
              {d.check_in ? `${fmtTime(d.check_in)}${d.check_out ? `–${fmtTime(d.check_out)}` : ''}` : d.status === 'on_leave' ? d.leave_name : d.holiday || (['off', 'upcoming', 'not_employed', 'not_marked'].includes(d.status) ? '' : STATUS_LABEL[d.status])}
            </span>
            {d.check_in && <span className="lbl" style={{ fontSize: 10.5 }}>{STATUS_LABEL[d.status]}</span>}
          </div>
        ))}
      </div>
      <div className="legend">
        {LEGEND.map(([k, c]) => <span key={k} style={{ '--c': c }}>{STATUS_LABEL[k]}</span>)}
      </div>
    </div>
  );
}
