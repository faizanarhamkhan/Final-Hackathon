import { all, get, run } from '../db/index.js';
import { parse, z, isoDate, optionalId } from '../lib/validate.js';
import { conflict, notFound } from '../lib/http.js';
import { audit } from './audit.js';

// ---- Departments ----

export function listDepartments() {
  return all(
    `SELECT d.*,
            (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status != 'exited') AS employee_count
       FROM departments d ORDER BY d.name`,
  );
}

const deptSchema = z.object({ name: z.string().trim().min(2, 'Name is required').max(80) });

export async function createDepartment(actor, input) {
  const { name } = parse(deptSchema, input);
  if (await get('SELECT 1 FROM departments WHERE lower(name) = lower(?)', name)) throw conflict('DUPLICATE', 'This department already exists');
  const row = await get('INSERT INTO departments (name) VALUES (?) RETURNING *', name);
  await audit(actor, 'department.create', 'department', row.id, null, row);
  return row;
}

export async function updateDepartment(actor, id, input) {
  const { name } = parse(deptSchema, input);
  const before = await get('SELECT * FROM departments WHERE id = ?', id);
  if (!before) throw notFound('Department not found');
  if (await get('SELECT 1 FROM departments WHERE lower(name) = lower(?) AND id != ?', name, id)) throw conflict('DUPLICATE', 'This department already exists');
  const after = await get('UPDATE departments SET name = ? WHERE id = ? RETURNING *', name, id);
  await audit(actor, 'department.update', 'department', id, before, after);
  return after;
}

export async function deleteDepartment(actor, id) {
  const before = await get('SELECT * FROM departments WHERE id = ?', id);
  if (!before) throw notFound('Department not found');
  if (await get('SELECT 1 FROM employees WHERE department_id = ? LIMIT 1', id)) {
    throw conflict('IN_USE', 'Move or remove the employees in this department first');
  }
  await run('DELETE FROM departments WHERE id = ?', id);
  await audit(actor, 'department.delete', 'department', id, before, null);
  return { ok: true };
}

export async function findDepartmentByName(name) {
  if (!name) return null;
  const n = String(name).trim();
  return (
    (await get('SELECT * FROM departments WHERE lower(name) = lower(?)', n)) ||
    (await get('SELECT * FROM departments WHERE name ILIKE ? ORDER BY length(name) LIMIT 1', `%${n}%`)) ||
    null
  );
}

// ---- Designations ----

export function listDesignations() {
  return all(
    `SELECT g.*, d.name AS department,
            (SELECT COUNT(*) FROM employees e WHERE e.designation_id = g.id AND e.status != 'exited') AS employee_count
       FROM designations g LEFT JOIN departments d ON d.id = g.department_id
      ORDER BY g.name`,
  );
}

const desigSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  department_id: optionalId,
});

async function assertDept(id) {
  if (id && !(await get('SELECT 1 FROM departments WHERE id = ?', id))) throw notFound('Department not found');
}

export async function createDesignation(actor, input) {
  const data = parse(desigSchema, input);
  await assertDept(data.department_id);
  if (await get('SELECT 1 FROM designations WHERE lower(name) = lower(?) AND COALESCE(department_id, 0) = ?', data.name, data.department_id ?? 0)) {
    throw conflict('DUPLICATE', 'This designation already exists');
  }
  const row = await get('INSERT INTO designations (name, department_id) VALUES (?, ?) RETURNING *', data.name, data.department_id ?? null);
  await audit(actor, 'designation.create', 'designation', row.id, null, row);
  return row;
}

export async function updateDesignation(actor, id, input) {
  const data = parse(desigSchema, input);
  const before = await get('SELECT * FROM designations WHERE id = ?', id);
  if (!before) throw notFound('Designation not found');
  await assertDept(data.department_id);
  const after = await get('UPDATE designations SET name = ?, department_id = ? WHERE id = ? RETURNING *', data.name, data.department_id ?? null, id);
  await audit(actor, 'designation.update', 'designation', id, before, after);
  return after;
}

export async function deleteDesignation(actor, id) {
  const before = await get('SELECT * FROM designations WHERE id = ?', id);
  if (!before) throw notFound('Designation not found');
  if (await get('SELECT 1 FROM employees WHERE designation_id = ? LIMIT 1', id)) throw conflict('IN_USE', 'This designation is assigned to employees');
  await run('DELETE FROM designations WHERE id = ?', id);
  await audit(actor, 'designation.delete', 'designation', id, before, null);
  return { ok: true };
}

// ---- Leave types ----

export function listLeaveTypes({ activeOnly = false } = {}) {
  return all(`SELECT * FROM leave_types ${activeOnly ? 'WHERE is_active' : ''} ORDER BY id`);
}

const quota = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(0).max(365).nullable());
const leaveTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,30}$/, 'Code: lowercase letters, numbers or underscore'),
  name: z.string().trim().min(2).max(60),
  yearly_quota: quota,
  is_paid: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

export async function createLeaveType(actor, input) {
  const data = parse(leaveTypeSchema, input);
  if (await get('SELECT 1 FROM leave_types WHERE code = ?', data.code)) throw conflict('DUPLICATE', 'A leave type with this code exists');
  const row = await get(
    'INSERT INTO leave_types (code, name, yearly_quota, is_paid, is_active) VALUES (?, ?, ?, ?, ?) RETURNING *',
    data.code,
    data.name,
    data.yearly_quota,
    data.is_paid,
    data.is_active,
  );
  await audit(actor, 'leave_type.create', 'leave_type', row.id, null, row);
  return row;
}

export async function updateLeaveType(actor, id, input) {
  const data = parse(leaveTypeSchema.omit({ code: true }), input);
  const before = await get('SELECT * FROM leave_types WHERE id = ?', id);
  if (!before) throw notFound('Leave type not found');
  const after = await get(
    'UPDATE leave_types SET name = ?, yearly_quota = ?, is_paid = ?, is_active = ? WHERE id = ? RETURNING *',
    data.name,
    data.yearly_quota,
    data.is_paid,
    data.is_active,
    id,
  );
  await audit(actor, 'leave_type.update', 'leave_type', id, before, after);
  return after;
}

export async function deleteLeaveType(actor, id) {
  const before = await get('SELECT * FROM leave_types WHERE id = ?', id);
  if (!before) throw notFound('Leave type not found');
  if (await get('SELECT 1 FROM leave_requests WHERE leave_type_id = ? LIMIT 1', id)) {
    throw conflict('IN_USE', 'This leave type has requests. Deactivate it instead.');
  }
  await run('DELETE FROM leave_types WHERE id = ?', id);
  await audit(actor, 'leave_type.delete', 'leave_type', id, before, null);
  return { ok: true };
}

// ---- Public holidays ----

export function listHolidays({ year } = {}) {
  if (year) return all('SELECT * FROM holidays WHERE extract(year FROM date) = ? ORDER BY date', Number(year));
  return all('SELECT * FROM holidays ORDER BY date');
}

const holidaySchema = z.object({ date: isoDate, name: z.string().trim().min(2).max(80) });

export async function createHoliday(actor, input) {
  const data = parse(holidaySchema, input);
  if (await get('SELECT 1 FROM holidays WHERE date = ?', data.date)) throw conflict('DUPLICATE', 'There is already a holiday on this date');
  const row = await get('INSERT INTO holidays (date, name) VALUES (?, ?) RETURNING *', data.date, data.name);
  await audit(actor, 'holiday.create', 'holiday', row.id, null, row);
  return row;
}

export async function updateHoliday(actor, id, input) {
  const data = parse(holidaySchema, input);
  const before = await get('SELECT * FROM holidays WHERE id = ?', id);
  if (!before) throw notFound('Holiday not found');
  if (await get('SELECT 1 FROM holidays WHERE date = ? AND id != ?', data.date, id)) throw conflict('DUPLICATE', 'There is already a holiday on this date');
  const after = await get('UPDATE holidays SET date = ?, name = ? WHERE id = ? RETURNING *', data.date, data.name, id);
  await audit(actor, 'holiday.update', 'holiday', id, before, after);
  return after;
}

export async function deleteHoliday(actor, id) {
  const before = await get('SELECT * FROM holidays WHERE id = ?', id);
  if (!before) throw notFound('Holiday not found');
  await run('DELETE FROM holidays WHERE id = ?', id);
  await audit(actor, 'holiday.delete', 'holiday', id, before, null);
  return { ok: true };
}
