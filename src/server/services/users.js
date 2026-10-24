import { all, get, run, tx } from '../db/index.js';
import { parse, z } from '../lib/validate.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/http.js';
import { hashPassword, tempPassword } from './passwords.js';
import { audit } from './audit.js';
import { notifyUser } from './comms.js';

const USER_COLS = `u.id, u.email, u.name, u.role, u.employee_id, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
                   e.code AS employee_code`;

const publicUser = (id) => get(`SELECT ${USER_COLS} FROM users u LEFT JOIN employees e ON e.id = u.employee_id WHERE u.id = ?`, id);

export function listUsers({ role, search } = {}) {
  const where = [];
  const params = [];
  if (role) (where.push('u.role = ?'), params.push(role));
  if (search) (where.push('(u.name ILIKE ? OR u.email ILIKE ?)'), params.push(`%${search}%`, `%${search}%`));
  return all(
    `SELECT ${USER_COLS} FROM users u LEFT JOIN employees e ON e.id = u.employee_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, u.name`,
    ...params,
  );
}

const hrSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
});

// Admin creates HR logins. Admin accounts only come from first-run setup.
export async function createHrUser(actor, input) {
  const data = parse(hrSchema, input);
  if (await get('SELECT 1 FROM users WHERE lower(email) = ?', data.email)) throw conflict('EMAIL_TAKEN', 'A login with this email already exists');
  const temp = tempPassword();
  const r = await get(
    "INSERT INTO users (email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, 'hr', true) RETURNING id",
    data.email,
    await hashPassword(temp),
    data.name,
  );
  const user = await publicUser(r.id);
  await audit(actor, 'user.create_hr', 'user', user.id, null, user);
  return { user, credentials: { email: data.email, tempPassword: temp } };
}

async function loadTarget(id) {
  const u = await get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('User not found');
  return u;
}

export async function setActive(actor, id, input) {
  const { is_active } = parse(z.object({ is_active: z.boolean() }), input);
  const u = await loadTarget(id);
  if (u.id === actor.id) throw unprocessable('SELF', 'You cannot deactivate your own account');
  if (u.role === 'admin' && !is_active) {
    const admins = (await get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active")).n;
    if (admins <= 1) throw unprocessable('LAST_ADMIN', 'The last active Admin cannot be deactivated');
  }
  const before = await publicUser(id);
  await run('UPDATE users SET is_active = ? WHERE id = ?', is_active, id);
  const after = await publicUser(id);
  await audit(actor, is_active ? 'user.activate' : 'user.deactivate', 'user', id, before, after);
  return after;
}

export async function resetPassword(actor, id) {
  const u = await loadTarget(id);
  if (u.id === actor.id) throw unprocessable('SELF', 'Use "Change password" for your own account');
  const temp = tempPassword();
  await run('UPDATE users SET password_hash = ?, must_change_password = true WHERE id = ?', await hashPassword(temp), id);
  await audit(actor, 'user.reset_password', 'user', id);
  return { user: await publicUser(id), credentials: { email: u.email, tempPassword: temp } };
}

// Admin can promote an employee's login to HR (or back). Nobody can create Admins here.
export async function setRole(actor, id, input) {
  const { role } = parse(z.object({ role: z.enum(['hr', 'employee']) }), input);
  return tx(async () => {
    const u = await loadTarget(id);
    if (u.role === 'admin') throw forbidden('Admin roles cannot be changed');
    if (role === 'employee' && !u.employee_id) {
      throw unprocessable('NO_EMPLOYEE', 'This login has no employee profile, so it cannot become an Employee login');
    }
    const before = await publicUser(id);
    await run('UPDATE users SET role = ? WHERE id = ?', role, id);
    const after = await publicUser(id);
    await audit(actor, 'user.change_role', 'user', id, before, after);
    await notifyUser(id, `Your role is now ${role.toUpperCase()}`, 'Sign out and back in if your menu has not updated.');
    return after;
  });
}
