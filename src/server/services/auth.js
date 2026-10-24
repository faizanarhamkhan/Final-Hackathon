import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { get, run, getMeta, setMeta, nowIso } from '../db/index.js';
import { config } from '../config.js';
import { parse, z, password } from '../lib/validate.js';
import { unauthorized, unprocessable, HttpError } from '../lib/http.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { audit } from './audit.js';
import { publicSettings } from './settings.js';

let cachedKey = null;
async function signingKey() {
  if (cachedKey) return cachedKey;
  let secret = config.jwtSecret;
  if (!secret) {
    // No JWT_SECRET configured: generate one once and keep it in the database.
    secret = await getMeta('jwt_secret');
    if (!secret) {
      secret = crypto.randomBytes(48).toString('hex');
      await setMeta('jwt_secret', secret);
    }
  }
  cachedKey = new TextEncoder().encode(secret);
  return cachedKey;
}

export async function signToken(user) {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(await signingKey());
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, await signingKey(), { algorithms: ['HS256'] });
    return payload;
  } catch {
    throw unauthorized('Your session has expired, please sign in again');
  }
}

// Routes a user with a temporary password may still call.
const PASSWORD_CHANGE_ALLOWED = new Set(['GET auth/me', 'POST auth/change-password', 'POST auth/logout']);

// Verifies the JWT and reloads the user on every request, so deactivation and role
// changes apply immediately.
export async function authenticate(request, routeKey) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  const payload = await verifyToken(token);
  const user = await get('SELECT id, email, name, role, employee_id, is_active, must_change_password FROM users WHERE id = ?', Number(payload.sub));
  if (!user || !user.is_active) throw unauthorized('Your account is not active');
  if (user.must_change_password && !PASSWORD_CHANGE_ALLOWED.has(routeKey)) {
    throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Please change your temporary password first');
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    employee_id: user.employee_id,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() || null,
  };
}

// Small in-memory brute-force guard per IP + email.
const attempts = new Map();
function throttle(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, reset: now + 15 * 60_000 };
  if (now > a.reset) (a.n = 0), (a.reset = now + 15 * 60_000);
  a.n++;
  attempts.set(key, a);
  if (a.n > 10) throw new HttpError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in a few minutes.');
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export async function login(input, ip) {
  const data = parse(loginSchema, input);
  throttle(`${ip}|${data.email}`);
  const user = await get('SELECT * FROM users WHERE lower(email) = ?', data.email);
  // Same message for an unknown email and a wrong password.
  if (!user || !(await verifyPassword(data.password, user.password_hash))) throw unauthorized('Email or password is incorrect');
  if (!user.is_active) throw unauthorized('This account has been deactivated. Contact your Admin.');
  attempts.delete(`${ip}|${data.email}`);
  await run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
  await audit({ ...user, ip }, 'auth.login', 'user', user.id);
  return { token: await signToken(user), user: await profile(user.id) };
}

export async function profile(userId) {
  const u = await get(
    `SELECT u.id, u.email, u.name, u.role, u.employee_id, u.must_change_password, u.last_login_at,
            e.code AS employee_code, e.department_id, d.name AS department, g.name AS designation
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN designations g ON g.id = e.designation_id
      WHERE u.id = ?`,
    userId,
  );
  return { ...u, settings: await publicSettings() };
}

const changeSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: password,
});

export async function changePassword(actor, input) {
  const data = parse(changeSchema, input);
  const user = await get('SELECT * FROM users WHERE id = ?', actor.id);
  if (!(await verifyPassword(data.current_password, user.password_hash))) {
    throw unprocessable('WRONG_PASSWORD', 'Current password is incorrect', [{ field: 'current_password', reason: 'Incorrect password' }]);
  }
  if (data.current_password === data.new_password) {
    throw unprocessable('SAME_PASSWORD', 'Choose a password different from the current one', [{ field: 'new_password', reason: 'Must be different' }]);
  }
  await run('UPDATE users SET password_hash = ?, must_change_password = false WHERE id = ?', await hashPassword(data.new_password), actor.id);
  await audit(actor, 'auth.change_password', 'user', actor.id);
  return { token: await signToken(user), user: await profile(actor.id) };
}
