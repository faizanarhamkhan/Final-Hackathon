import { all, get, run, tx, nowIso } from '../db/index.js';
import { parse, z, isoDate, optionalId } from '../lib/validate.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/http.js';
import { zonedNow, maxDate, minDate } from '../lib/dates.js';
import { ownEmployeeId, scopedEmployeeId } from '../lib/scope.js';
import { getSettings, workCalendar } from './settings.js';
import { audit } from './audit.js';
import { notifyEmployee, notifyRole } from './comms.js';

export async function workingDaysBetween(start, end) {
  return (await workCalendar(start, end)).workingDays(start, end);
}

export async function findLeaveType({ leave_type_id, type }) {
  if (leave_type_id) return get('SELECT * FROM leave_types WHERE id = ? AND is_active', Number(leave_type_id));
  if (type) return get('SELECT * FROM leave_types WHERE (lower(code) = lower(?) OR lower(name) = lower(?)) AND is_active', type, type);
  return null;
}

/**
 * Balance per leave type for a calendar year.
 *   remaining = quota − approved          (what the employee "has left")
 *   available = quota − approved − pending (what can still be requested)
 */
export async function balances(employeeId, year) {
  const y = Number(year || zonedNow((await getSettings()).timezone).date.slice(0, 4));
  const used = await all(
    `SELECT leave_type_id, status, SUM(days) AS days FROM leave_requests
      WHERE employee_id = ? AND status IN ('approved','pending') AND extract(year FROM start_date) = ?
      GROUP BY leave_type_id, status`,
    employeeId,
    y,
  );
  return (await all('SELECT * FROM leave_types WHERE is_active ORDER BY id')).map((t) => {
    const approved = used.find((u) => u.leave_type_id === t.id && u.status === 'approved')?.days || 0;
    const pending = used.find((u) => u.leave_type_id === t.id && u.status === 'pending')?.days || 0;
    const quota = t.yearly_quota;
    return {
      leave_type_id: t.id,
      code: t.code,
      name: t.name,
      is_paid: t.is_paid,
      year: y,
      quota,
      used: approved,
      pending,
      remaining: quota == null ? null : quota - approved,
      available: quota == null ? null : quota - approved - pending,
    };
  });
}

export async function myBalances(actor, { year, employee_id } = {}) {
  const employeeId = scopedEmployeeId(actor, employee_id) ?? ownEmployeeId(actor);
  return balances(employeeId, year);
}

export const applySchema = z
  .object({
    leave_type_id: optionalId,
    type: z.string().trim().optional(),
    start_date: isoDate,
    end_date: isoDate,
    reason: z.string().trim().min(3, 'Please add a short reason').max(500),
    source: z.enum(['form', 'ai']).default('form'),
  })
  .refine((d) => d.leave_type_id || d.type, { message: 'Choose a leave type', path: ['leave_type_id'] })
  .refine((d) => d.start_date <= d.end_date, { message: 'End date must be on or after the start date', path: ['end_date'] });

// Shared by the form, the smart-leave draft and the AI tool so they apply the same rules.
export async function checkLeaveRequest(employeeId, data) {
  const type = await findLeaveType(data);
  if (!type) throw unprocessable('VALIDATION_ERROR', 'Unknown leave type', [{ field: 'leave_type_id', reason: 'Unknown leave type' }]);
  if (data.start_date.slice(0, 4) !== data.end_date.slice(0, 4)) {
    throw unprocessable('CROSSES_YEAR', 'Leave cannot cross into a new year. Split it into two requests.');
  }
  const emp = await get('SELECT join_date FROM employees WHERE id = ?', employeeId);
  if (data.start_date < emp.join_date) throw unprocessable('BEFORE_JOINING', 'Leave cannot start before the joining date');
  const days = await workingDaysBetween(data.start_date, data.end_date);
  if (days === 0) {
    throw unprocessable('NO_WORKING_DAYS', 'The selected dates are all weekends or public holidays, so no leave is needed', [
      { field: 'start_date', reason: 'No working days in range' },
    ]);
  }
  const overlap = await get(
    `SELECT lr.*, lt.name AS type_name FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id
      WHERE lr.employee_id = ? AND lr.status IN ('pending','approved') AND lr.start_date <= ? AND lr.end_date >= ? AND lr.id IS DISTINCT FROM ?`,
    employeeId,
    data.end_date,
    data.start_date,
    data.exclude_id ?? null,
  );
  if (overlap) {
    throw unprocessable('OVERLAP', `This overlaps an existing ${overlap.status} ${overlap.type_name} (${overlap.start_date} to ${overlap.end_date})`, [
      { field: 'start_date', reason: 'Overlaps another request' },
    ]);
  }
  const bal = (await balances(employeeId, data.start_date.slice(0, 4))).find((b) => b.leave_type_id === type.id);
  // At approval time only already-approved days count against the quota.
  const available = data.exclude_id ? bal.remaining : bal.available;
  if (bal.quota != null && days > available) {
    throw unprocessable(
      'INSUFFICIENT_BALANCE',
      `Not enough ${type.name} balance: requested ${days} day(s), available ${Math.max(0, available)}${bal.pending && !data.exclude_id ? ` (${bal.pending} pending)` : ''}`,
      [{ field: 'leave_type_id', reason: 'Insufficient balance' }],
    );
  }
  return { type, days, balance: bal };
}

const SELECT_REQUEST = `
  SELECT lr.*, lt.code AS type_code, lt.name AS type_name, e.first_name || ' ' || e.last_name AS name, e.code AS employee_code,
         e.department_id, d.name AS department, u.name AS reviewer_name
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    JOIN employees e ON e.id = lr.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN users u ON u.id = lr.reviewer_id`;

const getRequest = (id) => get(`${SELECT_REQUEST} WHERE lr.id = ?`, id);

export async function applyLeave(actor, input) {
  const employeeId = ownEmployeeId(actor);
  const data = parse(applySchema, input);
  return tx(async () => {
    // Serialise requests per employee so two parallel submits cannot both pass the balance check.
    await get('SELECT id FROM employees WHERE id = ? FOR UPDATE', employeeId);
    const { type, days } = await checkLeaveRequest(employeeId, data);
    const r = await get(
      'INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days, reason, source) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      employeeId,
      type.id,
      data.start_date,
      data.end_date,
      days,
      data.reason,
      data.source,
    );
    const row = await getRequest(r.id);
    await audit(actor, 'leave.apply', 'leave_request', row.id, null, row);
    await notifyRole('hr', 'New leave request', `${actor.name}: ${type.name}, ${data.start_date} to ${data.end_date} (${days} day${days === 1 ? '' : 's'})`, '/leave', actor.id);
    return row;
  });
}

export async function listRequests(actor, { status, employee_id, department_id, from, to, leave_type_id } = {}) {
  const employeeId = scopedEmployeeId(actor, employee_id);
  const where = [];
  const params = [];
  if (employeeId) (where.push('lr.employee_id = ?'), params.push(employeeId));
  if (status) (where.push('lr.status = ?'), params.push(status));
  if (department_id) (where.push('e.department_id = ?'), params.push(Number(department_id)));
  if (leave_type_id) (where.push('lr.leave_type_id = ?'), params.push(Number(leave_type_id)));
  if (from) (where.push('lr.end_date >= ?'), params.push(from));
  if (to) (where.push('lr.start_date <= ?'), params.push(to));
  return all(
    `${SELECT_REQUEST} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END, lr.start_date DESC LIMIT 500`,
    ...params,
  );
}

export async function cancelLeave(actor, id) {
  return tx(async () => {
    const row = await getRequest(id);
    if (!row) throw notFound('Leave request not found');
    if (row.employee_id !== actor.employee_id) throw forbidden('You can only cancel your own leave');
    const todayDate = zonedNow((await getSettings()).timezone).date;
    if (row.status === 'pending' || (row.status === 'approved' && row.start_date > todayDate)) {
      await run("UPDATE leave_requests SET status = 'cancelled' WHERE id = ?", id);
      const after = await getRequest(id);
      await audit(actor, 'leave.cancel', 'leave_request', id, row, after);
      if (row.status === 'approved') await notifyRole('hr', 'Approved leave cancelled', `${row.name}: ${row.start_date} to ${row.end_date}`, '/leave', actor.id);
      return after;
    }
    throw conflict('CANNOT_CANCEL', row.status === 'approved' ? 'Leave that has already started cannot be cancelled' : `This request is already ${row.status}`);
  });
}

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.preprocess((v) => (v == null ? '' : v), z.string().trim().max(500)),
});

export async function reviewLeave(actor, id, input) {
  const data = parse(reviewSchema, input);
  return tx(async () => {
    const locked = await get('SELECT id FROM leave_requests WHERE id = ? FOR UPDATE', id);
    if (!locked) throw notFound('Leave request not found');
    const row = await getRequest(id);
    if (row.status !== 'pending') throw conflict('ALREADY_REVIEWED', `This request is already ${row.status}`);
    if (actor.employee_id && row.employee_id === actor.employee_id) throw forbidden('You cannot approve your own leave');
    if (data.decision === 'rejected' && !data.comment) {
      throw unprocessable('VALIDATION_ERROR', 'Add a comment explaining the rejection', [{ field: 'comment', reason: 'Required when rejecting' }]);
    }
    if (data.decision === 'approved') {
      // Re-check balance and overlap in case something changed since the request.
      await checkLeaveRequest(row.employee_id, { leave_type_id: row.leave_type_id, start_date: row.start_date, end_date: row.end_date, exclude_id: row.id });
    }
    await run(
      'UPDATE leave_requests SET status = ?, reviewer_id = ?, review_comment = ?, reviewed_at = ? WHERE id = ?',
      data.decision,
      actor.id,
      data.comment || null,
      nowIso(),
      id,
    );
    const after = await getRequest(id);
    await audit(actor, data.decision === 'approved' ? 'leave.approve' : 'leave.reject', 'leave_request', id, row, after);
    await notifyEmployee(
      row.employee_id,
      `Leave ${data.decision}`,
      `${row.type_name}, ${row.start_date} to ${row.end_date}${data.comment ? ` - "${data.comment}"` : ''}`,
      '/my/leave',
    );
    return after;
  });
}

// Who is on approved leave on a date (dashboards and the AI use this).
export async function onLeaveOn(date, departmentId = null) {
  if (!(await workCalendar(date, date)).isWorking(date)) return [];
  return all(
    `SELECT lr.id, lr.employee_id, e.first_name || ' ' || e.last_name AS name, e.code, d.name AS department,
            lt.code AS type_code, lt.name AS type_name, lr.start_date, lr.end_date
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ? ${departmentId ? 'AND e.department_id = ?' : ''}
      ORDER BY e.first_name`,
    date,
    date,
    ...(departmentId ? [Number(departmentId)] : []),
  );
}

// Approved leave days inside [from, to] per leave type (working days only).
export async function leaveDaysByType(from, to, { departmentId = null, employeeId = null } = {}) {
  const rows = await all(
    `SELECT lr.employee_id, lr.start_date, lr.end_date, lr.leave_type_id
       FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
      WHERE lr.status = 'approved' AND lr.start_date <= ? AND lr.end_date >= ?
        ${departmentId ? 'AND e.department_id = ?' : ''} ${employeeId ? 'AND lr.employee_id = ?' : ''}`,
    to,
    from,
    ...(departmentId ? [Number(departmentId)] : []),
    ...(employeeId ? [Number(employeeId)] : []),
  );
  const cal = await workCalendar(from, to);
  const byType = new Map((await all('SELECT id, code, name, yearly_quota FROM leave_types ORDER BY id')).map((t) => [t.id, { ...t, days: 0, requests: 0 }]));
  for (const r of rows) {
    const t = byType.get(r.leave_type_id);
    t.days += cal.workingDays(maxDate(r.start_date, from), minDate(r.end_date, to));
    t.requests += 1;
  }
  return [...byType.values()];
}
