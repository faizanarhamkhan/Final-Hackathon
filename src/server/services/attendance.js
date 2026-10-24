import { all, get, run, tx, nowIso, marks } from '../db/index.js';
import { parse, z, isoDate, hhmm, month as monthSchema } from '../lib/validate.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/http.js';
import { eachDay, monthRange, minDate, timeToSeconds, zonedNow, addDays } from '../lib/dates.js';
import { haversineMeters } from '../lib/geo.js';
import { round2 } from '../lib/money.js';
import { ownEmployeeId, scopedEmployeeId } from '../lib/scope.js';
import { getSettings, workCalendar } from './settings.js';
import { audit } from './audit.js';
import { notifyEmployee, notifyRole } from './comms.js';

export const COUNTED_STATUSES = ['present', 'late', 'half_day', 'missing_checkout', 'absent', 'on_leave'];

export function rulesSnapshot(s) {
  return { office_start: s.office_start, grace_minutes: s.grace_minutes, half_day_hours: s.half_day_hours };
}

// Late after office start + grace; half day when fewer than N hours were worked.
export function evaluate(checkIn, checkOut, rules) {
  const inSec = timeToSeconds(checkIn);
  const lateAfter = timeToSeconds(rules.office_start) + rules.grace_minutes * 60;
  const isLate = inSec > lateAfter;
  let status = isLate ? 'late' : 'present';
  let hours = null;
  if (checkOut) {
    hours = round2((timeToSeconds(checkOut) - inSec) / 3600);
    if (hours < rules.half_day_hours) status = 'half_day';
  }
  return { status, is_late: isLate, hours };
}

const geoSchema = z.object({
  source: z.enum(['web', 'camera']).default('web'),
  face_count: z.coerce.number().int().min(0).max(20).optional(),
  liveness: z.boolean().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  accuracy: z.coerce.number().min(0).optional(),
});

// The phone only sends data; the server decides (face count, GPS accuracy, Haversine distance).
export function verifyCameraCheck(settings, data) {
  if (settings.office_lat == null || settings.office_lng == null) {
    throw unprocessable('CAMERA_DISABLED', 'Camera attendance is not available until Admin sets the office location');
  }
  if (!data.face_count) throw unprocessable('NO_FACE', 'No face detected. Look at the camera and try again.');
  if (data.face_count > 1) throw unprocessable('MULTIPLE_FACES', 'More than one face detected. Only you should be in the frame.');
  if (data.lat == null || data.lng == null) throw unprocessable('NO_LOCATION', 'Location is required for camera check-in');
  if (data.accuracy == null || data.accuracy > 100) {
    throw unprocessable(
      'LOW_ACCURACY',
      `GPS accuracy is ${data.accuracy == null ? 'unknown' : `${Math.round(data.accuracy)} m`}; it must be 100 m or better. Move near a window and retry.`,
    );
  }
  const distance = haversineMeters(settings.office_lat, settings.office_lng, data.lat, data.lng);
  if (distance > settings.office_radius_m) {
    throw unprocessable('OUTSIDE_OFFICE', `You are ${Math.round(distance)} m from the office; check-in is allowed within ${settings.office_radius_m} m.`);
  }
  return { lat: data.lat, lng: data.lng, accuracy_m: data.accuracy, distance_m: round2(distance) };
}

const recordOn = (employeeId, date) => get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', employeeId, date);

export async function getToday(actor) {
  const employeeId = ownEmployeeId(actor);
  const s = await getSettings();
  const now = zonedNow(s.timezone);
  const cal = await workCalendar(now.date, now.date);
  return {
    date: now.date,
    server_time: now.time,
    working_day: cal.isWorking(now.date),
    holiday: cal.holidayName(now.date),
    record: (await recordOn(employeeId, now.date)) || null,
    camera_enabled: s.office_lat != null,
    office_start: s.office_start,
    grace_minutes: s.grace_minutes,
  };
}

async function logRejectedCamera(actor, err, data) {
  if (err?.status === 422) {
    await audit(actor, 'attendance.camera_rejected', 'attendance', null, null, { reason: err.code, face_count: data.face_count, accuracy: data.accuracy });
  }
}

export async function checkIn(actor, input) {
  const employeeId = ownEmployeeId(actor);
  const data = parse(geoSchema, input);
  const s = await getSettings();
  const now = zonedNow(s.timezone); // the server stamps the time
  let geo = {};
  if (data.source === 'camera') {
    try {
      geo = verifyCameraCheck(s, data);
    } catch (e) {
      await logRejectedCamera(actor, e, data);
      throw e;
    }
  }
  return tx(async () => {
    if (await recordOn(employeeId, now.date)) throw conflict('ALREADY_CHECKED_IN', 'You have already checked in today');
    const rules = rulesSnapshot(s);
    const ev = evaluate(now.time, null, rules);
    const row = await get(
      `INSERT INTO attendance (employee_id, date, check_in, status, is_late, source, lat, lng, accuracy_m, distance_m, rules)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb) RETURNING *`,
      employeeId,
      now.date,
      now.time,
      ev.status,
      ev.is_late,
      data.source,
      geo.lat ?? null,
      geo.lng ?? null,
      geo.accuracy_m ?? null,
      geo.distance_m ?? null,
      JSON.stringify(rules),
    );
    await audit(actor, 'attendance.check_in', 'attendance', row.id, null, row);
    return row;
  });
}

export async function checkOut(actor, input) {
  const employeeId = ownEmployeeId(actor);
  const data = parse(geoSchema, input);
  const s = await getSettings();
  const now = zonedNow(s.timezone);
  let geo = {};
  if (data.source === 'camera') {
    try {
      geo = verifyCameraCheck(s, data);
    } catch (e) {
      await logRejectedCamera(actor, e, data);
      throw e;
    }
  }
  return tx(async () => {
    const rec = await recordOn(employeeId, now.date);
    if (!rec) throw unprocessable('NOT_CHECKED_IN', 'You have not checked in today');
    if (rec.check_out) throw conflict('ALREADY_CHECKED_OUT', 'You have already checked out today');
    const ev = evaluate(rec.check_in, now.time, rec.rules || rulesSnapshot(s));
    const row = await get(
      'UPDATE attendance SET check_out = ?, hours = ?, status = ?, updated_at = ?, distance_m = COALESCE(?, distance_m) WHERE id = ? RETURNING *',
      now.time,
      ev.hours,
      ev.status,
      nowIso(),
      geo.distance_m ?? null,
      rec.id,
    );
    await audit(actor, 'attendance.check_out', 'attendance', row.id, rec, row);
    return row;
  });
}

// Past records that were never checked out become missing_checkout.
export async function sweepMissingCheckout(todayDate) {
  await run(
    "UPDATE attendance SET status = 'missing_checkout', updated_at = ? WHERE check_out IS NULL AND date < ? AND status != 'missing_checkout'",
    nowIso(),
    todayDate,
  );
}

/**
 * The single place that decides an employee's status for each day. Payroll, dashboards,
 * calendars and the AI assistant all read from here, so their numbers always agree.
 *
 * present | late | half_day | missing_checkout  -> from attendance records
 * on_leave   -> approved leave on a working day
 * absent     -> past working day with no record and no approved leave
 * not_marked -> today, nothing recorded yet (not counted as absent until the day is over)
 * upcoming   -> future working day; off -> weekend / public holiday
 */
export async function dayStatuses({ from, to, employeeId = null, departmentId = null, includeOff = false, includeFuture = false }) {
  const s = await getSettings();
  const todayDate = zonedNow(s.timezone).date;
  await sweepMissingCheckout(todayDate);
  const end = includeFuture ? to : minDate(to, todayDate);
  if (from > end) return [];

  const where = ['e.join_date <= ?', '(e.exit_date IS NULL OR e.exit_date >= ?)'];
  const params = [end, from];
  if (employeeId) (where.push('e.id = ?'), params.push(Number(employeeId)));
  if (departmentId) (where.push('e.department_id = ?'), params.push(Number(departmentId)));
  const emps = await all(
    `SELECT e.id, e.code, e.first_name || ' ' || e.last_name AS name, e.department_id, d.name AS department, e.join_date, e.exit_date
       FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      WHERE ${where.join(' AND ')} ORDER BY e.first_name, e.last_name`,
    ...params,
  );
  if (!emps.length) return [];
  const ids = emps.map((e) => e.id);

  const records = new Map(
    (await all(`SELECT * FROM attendance WHERE date BETWEEN ? AND ? AND employee_id IN (${marks(ids)})`, from, end, ...ids)).map((r) => [
      `${r.employee_id}|${r.date}`,
      r,
    ]),
  );
  const leaves = new Map();
  for (const l of await all(
    `SELECT lr.employee_id, lr.start_date, lr.end_date, lt.code, lt.name, lt.is_paid
       FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ? AND lr.employee_id IN (${marks(ids)})`,
    end,
    from,
    ...ids,
  )) {
    if (!leaves.has(l.employee_id)) leaves.set(l.employee_id, []);
    leaves.get(l.employee_id).push(l);
  }
  const cal = await workCalendar(from, end);
  const out = [];
  for (const d of eachDay(from, end)) {
    const working = cal.isWorking(d);
    for (const e of emps) {
      if (d < e.join_date || (e.exit_date && d > e.exit_date)) continue;
      const rec = records.get(`${e.id}|${d}`);
      const base = { employee_id: e.id, code: e.code, name: e.name, department_id: e.department_id, department: e.department, date: d, working_day: working };
      if (rec) {
        // A record on a weekend/holiday still counts as worked (e.g. a Saturday event).
        const status = d < todayDate && !rec.check_out ? 'missing_checkout' : rec.status;
        out.push({ ...base, status, is_late: rec.is_late, check_in: rec.check_in, check_out: rec.check_out, hours: rec.hours, source: rec.source });
        continue;
      }
      if (!working) {
        if (includeOff) out.push({ ...base, status: 'off', holiday: cal.holidayName(d) });
        continue;
      }
      const leave = (leaves.get(e.id) || []).find((l) => l.start_date <= d && l.end_date >= d);
      if (leave) out.push({ ...base, status: 'on_leave', leave_code: leave.code, leave_name: leave.name, leave_paid: leave.is_paid });
      else if (d < todayDate) out.push({ ...base, status: 'absent' });
      else if (d === todayDate) out.push({ ...base, status: 'not_marked' });
      else out.push({ ...base, status: 'upcoming' });
    }
  }
  return out;
}

// Attendance rate = (present + late + missing_checkout + 0.5 × half_day) ÷ (working-day records − on_leave)
export function summarize(rows) {
  const c = { present: 0, late: 0, half_day: 0, missing_checkout: 0, absent: 0, on_leave: 0 };
  let lateFlags = 0;
  for (const r of rows) {
    if (r.status in c) c[r.status]++;
    if (r.is_late) lateFlags++;
  }
  const records = COUNTED_STATUSES.reduce((sum, k) => sum + c[k], 0);
  const expected = records - c.on_leave;
  const attended = c.present + c.late + c.missing_checkout + 0.5 * c.half_day;
  return {
    counts: c,
    records,
    expected_days: expected,
    late_arrivals: lateFlags,
    attendance_rate: expected ? round2((attended / expected) * 100) : null,
    late_pct: c.present + c.late ? round2((c.late / (c.present + c.late)) * 100) : null,
    absenteeism_pct: expected ? round2((c.absent / expected) * 100) : null,
  };
}

export async function calendarMonth(actor, { month, employee_id } = {}) {
  const employeeId = scopedEmployeeId(actor, employee_id) ?? ownEmployeeId(actor);
  const s = await getSettings();
  const m = parse(monthSchema, month || zonedNow(s.timezone).month);
  const { start, end } = monthRange(m);
  const days = await dayStatuses({ from: start, to: end, employeeId, includeOff: true, includeFuture: true });
  const cal = await workCalendar(start, end);
  // Days before joining / after exit still appear so the calendar grid is complete.
  const byDate = new Map(days.map((d) => [d.date, d]));
  const grid = eachDay(start, end).map((d) => byDate.get(d) || { date: d, status: 'not_employed', working_day: cal.isWorking(d), holiday: cal.holidayName(d) });
  const corrections = await all('SELECT * FROM attendance_corrections WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY id DESC', employeeId, start, end);
  return { month: m, employee_id: employeeId, days: grid, summary: summarize(days), corrections };
}

export async function board(actor, { date, department_id } = {}) {
  const s = await getSettings();
  const d = date ? parse(isoDate, date) : zonedNow(s.timezone).date;
  const rows = await dayStatuses({ from: d, to: d, departmentId: department_id || null, includeOff: true, includeFuture: true });
  return { date: d, rows, summary: summarize(rows) };
}

export async function listRecords(actor, { employee_id, from, to } = {}) {
  const employeeId = scopedEmployeeId(actor, employee_id);
  const s = await getSettings();
  const t = to || zonedNow(s.timezone).date;
  const f = from || addDays(t, -30);
  return all(
    `SELECT a.*, e.first_name || ' ' || e.last_name AS name, e.code FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN ? AND ? ${employeeId ? 'AND a.employee_id = ?' : ''} ORDER BY a.date DESC, e.first_name LIMIT 1000`,
    f,
    t,
    ...(employeeId ? [employeeId] : []),
  );
}

// ---- Corrections ----

const correctionSchema = z
  .object({
    date: isoDate,
    check_in: hhmm,
    check_out: z.preprocess((v) => (v === '' ? null : v), hhmm.nullable().optional()),
    reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500),
  })
  .refine((d) => !d.check_out || d.check_out > d.check_in, { message: 'Check-out must be after check-in', path: ['check_out'] });

export async function requestCorrection(actor, input) {
  const employeeId = ownEmployeeId(actor);
  const data = parse(correctionSchema, input);
  const s = await getSettings();
  const todayDate = zonedNow(s.timezone).date;
  if (data.date > todayDate) throw unprocessable('FUTURE_DATE', 'You cannot request a correction for a future date');
  const emp = await get('SELECT join_date FROM employees WHERE id = ?', employeeId);
  if (data.date < emp.join_date) throw unprocessable('BEFORE_JOINING', 'This date is before your joining date');
  if (await get("SELECT 1 FROM attendance_corrections WHERE employee_id = ? AND date = ? AND status = 'pending'", employeeId, data.date)) {
    throw conflict('PENDING_EXISTS', 'You already have a pending correction for this date');
  }
  const row = await get(
    'INSERT INTO attendance_corrections (employee_id, date, check_in, check_out, reason) VALUES (?, ?, ?, ?, ?) RETURNING *',
    employeeId,
    data.date,
    data.check_in,
    data.check_out ?? null,
    data.reason,
  );
  await audit(actor, 'attendance_correction.request', 'attendance_correction', row.id, null, row);
  await notifyRole('hr', 'New attendance correction request', `${actor.name} - ${data.date}`, '/attendance?tab=corrections', actor.id);
  return row;
}

export async function listCorrections(actor, { status, employee_id } = {}) {
  const employeeId = scopedEmployeeId(actor, employee_id);
  const where = [];
  const params = [];
  if (employeeId) (where.push('c.employee_id = ?'), params.push(employeeId));
  if (status) (where.push('c.status = ?'), params.push(status));
  return all(
    `SELECT c.*, e.first_name || ' ' || e.last_name AS name, e.code, d.name AS department, u.name AS reviewer_name,
            a.check_in AS current_check_in, a.check_out AS current_check_out, a.status AS current_status
       FROM attendance_corrections c
       JOIN employees e ON e.id = c.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN users u ON u.id = c.reviewer_id
       LEFT JOIN attendance a ON a.employee_id = c.employee_id AND a.date = c.date
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.id DESC LIMIT 500`,
    ...params,
  );
}

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.preprocess((v) => (v == null ? '' : v), z.string().trim().max(500)),
});

export async function reviewCorrection(actor, id, input) {
  const data = parse(reviewSchema, input);
  return tx(async () => {
    const c = await get('SELECT * FROM attendance_corrections WHERE id = ? FOR UPDATE', id);
    if (!c) throw notFound('Correction request not found');
    if (c.status !== 'pending') throw conflict('ALREADY_REVIEWED', `This request was already ${c.status}`);
    if (actor.employee_id && c.employee_id === actor.employee_id) throw forbidden('You cannot approve your own correction');
    if (data.decision === 'rejected' && !data.comment) {
      throw unprocessable('VALIDATION_ERROR', 'Add a comment explaining the rejection', [{ field: 'comment', reason: 'Required when rejecting' }]);
    }
    await run(
      'UPDATE attendance_corrections SET status = ?, reviewer_id = ?, review_comment = ?, reviewed_at = ? WHERE id = ?',
      data.decision,
      actor.id,
      data.comment || null,
      nowIso(),
      id,
    );
    let record = null;
    if (data.decision === 'approved') {
      const s = await getSettings();
      const rules = rulesSnapshot(s);
      const checkIn = `${c.check_in}:00`;
      const checkOut = c.check_out ? `${c.check_out}:00` : null;
      const ev = evaluate(checkIn, checkOut, rules);
      const status = !checkOut && c.date < zonedNow(s.timezone).date ? 'missing_checkout' : ev.status;
      const existing = await recordOn(c.employee_id, c.date);
      if (existing) {
        record = await get(
          "UPDATE attendance SET check_in = ?, check_out = ?, hours = ?, status = ?, is_late = ?, source = 'correction', rules = ?::jsonb, updated_at = ? WHERE id = ? RETURNING *",
          checkIn,
          checkOut,
          ev.hours,
          status,
          ev.is_late,
          JSON.stringify(rules),
          nowIso(),
          existing.id,
        );
        await audit(actor, 'attendance.correct', 'attendance', existing.id, existing, record);
      } else {
        record = await get(
          "INSERT INTO attendance (employee_id, date, check_in, check_out, hours, status, is_late, source, rules) VALUES (?, ?, ?, ?, ?, ?, ?, 'correction', ?::jsonb) RETURNING *",
          c.employee_id,
          c.date,
          checkIn,
          checkOut,
          ev.hours,
          status,
          ev.is_late,
          JSON.stringify(rules),
        );
        await audit(actor, 'attendance.correct', 'attendance', record.id, null, record);
      }
    }
    const after = await get('SELECT * FROM attendance_corrections WHERE id = ?', id);
    await audit(actor, `attendance_correction.${data.decision === 'approved' ? 'approve' : 'reject'}`, 'attendance_correction', id, c, after);
    await notifyEmployee(c.employee_id, `Attendance correction ${data.decision}`, `${c.date}${data.comment ? ` - ${data.comment}` : ''}`, '/my/attendance');
    return { correction: after, record };
  });
}

export async function hoursBetween(employeeId, from, to) {
  const r = await get('SELECT COALESCE(SUM(hours), 0) AS h FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?', employeeId, from, to);
  return round2(r.h);
}
