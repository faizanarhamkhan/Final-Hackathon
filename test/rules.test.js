import test from 'node:test';
import assert from 'node:assert/strict';
import { annualTax } from '../src/server/lib/money.js';
import { haversineMeters } from '../src/server/lib/geo.js';
import { evaluate, summarize } from '../src/server/services/attendance.js';
import { parseLeaveText, extractDates } from '../src/server/services/ai/dateText.js';

test('tax slabs match the brief', () => {
  assert.equal(annualTax(600000), 0);
  assert.equal(annualTax(1200000), 30000);
  assert.equal(annualTax(900000), 15000);
  assert.equal(annualTax(2400000), 210000);
  assert.equal(annualTax(3600000), 510000);
  assert.equal(annualTax(4600000), 510000 + 350000);
});

test('attendance status rules: late after 09:15, half day under 5 h', () => {
  const rules = { office_start: '09:00', grace_minutes: 15, half_day_hours: 5 };
  assert.equal(evaluate('09:15:00', null, rules).status, 'present');
  assert.equal(evaluate('09:15:01', null, rules).status, 'late');
  assert.equal(evaluate('09:00:00', '13:59:00', rules).status, 'half_day');
  const full = evaluate('09:30:00', '18:00:00', rules);
  assert.equal(full.status, 'late');
  assert.equal(full.hours, 8.5);
});

test('attendance rate formula', () => {
  const rows = [
    { status: 'present' },
    { status: 'late', is_late: true },
    { status: 'half_day' },
    { status: 'missing_checkout' },
    { status: 'absent' },
    { status: 'on_leave' },
  ];
  // (1 + 1 + 1 + 0.5) / (6 - 1) = 70%
  assert.equal(summarize(rows).attendance_rate, 70);
  assert.equal(summarize(rows).late_pct, 50);
});

test('haversine distance', () => {
  // ~111 m per 0.001 degree of latitude
  const d = haversineMeters(24.86, 67.0, 24.861, 67.0);
  assert.ok(d > 105 && d < 117, String(d));
});

test('smart leave parser: "next Monday and Tuesday" from Saturday 24 Oct 2026', () => {
  const r = parseLeaveText("I need next Monday and Tuesday off for my sister's wedding", '2026-10-24', ['annual', 'sick', 'casual', 'unpaid']);
  assert.deepEqual(r, { type: 'casual', start_date: '2026-10-26', end_date: '2026-10-27', reason: "My sister's wedding" });
});

test('smart leave parser: Roman Urdu and explicit dates', () => {
  const codes = ['annual', 'sick', 'casual', 'unpaid'];
  assert.equal(parseLeaveText('kal bemar hoon chutti chahiye', '2026-10-24', codes).type, 'sick');
  assert.deepEqual(extractDates('from 3 Nov to 5 Nov', '2026-10-24'), ['2026-11-03', '2026-11-05']);
  const r = parseLeaveText('annual leave from 2026-12-01 for 3 days', '2026-10-24', codes, (d) => !['2026-12-05', '2026-12-06'].includes(d));
  assert.equal(r.end_date, '2026-12-03');
});
