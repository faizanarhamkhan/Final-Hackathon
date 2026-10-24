import { get, run, tx, nowIso } from '../db/index.js';
import { parse, z, password } from '../lib/validate.js';
import { conflict } from '../lib/http.js';
import { isValidTimeZone } from '../lib/dates.js';
import { config } from '../config.js';
import { hashPassword } from './passwords.js';
import { audit } from './audit.js';

// Leave rules from the brief. They are configuration (Admin can edit them), not dummy data.
export const DEFAULT_LEAVE_TYPES = [
  { code: 'annual', name: 'Annual leave', yearly_quota: 14, is_paid: true },
  { code: 'sick', name: 'Sick leave', yearly_quota: 8, is_paid: true },
  { code: 'casual', name: 'Casual leave', yearly_quota: 10, is_paid: true },
  { code: 'unpaid', name: 'Unpaid leave', yearly_quota: null, is_paid: false },
];

export async function isSetupDone() {
  return !!(await get("SELECT 1 AS ok FROM users WHERE role = 'admin' LIMIT 1"));
}

let envChecked = false;
// ADMIN_EMAIL / ADMIN_PASSWORD in the env skip the setup screen.
export async function ensureBootstrap() {
  if (envChecked) return;
  envChecked = true;
  if (!config.admin.email || !config.admin.password || (await isSetupDone())) return;
  try {
    await runSetup({
      company_name: config.admin.company || 'My Company',
      admin_name: 'Administrator',
      admin_email: config.admin.email,
      admin_password: config.admin.password,
    });
    console.log(`[setup] Admin account created from env: ${config.admin.email}`);
  } catch (e) {
    console.error('[setup] env bootstrap failed:', e.message);
  }
}

export async function setupStatus() {
  await ensureBootstrap();
  const s = await get('SELECT company_name FROM settings WHERE id = 1');
  return { setupDone: await isSetupDone(), companyName: s?.company_name || null };
}

const setupSchema = z.object({
  company_name: z.string().trim().min(2, 'Company name is required').max(120),
  timezone: z.string().trim().refine(isValidTimeZone, 'Unknown time zone').default('Asia/Karachi'),
  admin_name: z.string().trim().min(2, 'Your name is required').max(100),
  admin_email: z.string().trim().toLowerCase().email('Enter a valid email'),
  admin_password: password,
});

export async function runSetup(input) {
  const data = parse(setupSchema, input);
  const hash = await hashPassword(data.admin_password);
  return tx(async () => {
    if (await isSetupDone()) throw conflict('ALREADY_SETUP', 'Setup has already been completed');
    await run('UPDATE settings SET company_name = ?, timezone = ?, setup_completed_at = ?, updated_at = ? WHERE id = 1', data.company_name, data.timezone, nowIso(), nowIso());
    const admin = await get(
      "INSERT INTO users (email, password_hash, name, role, must_change_password) VALUES (?, ?, ?, 'admin', false) RETURNING id",
      data.admin_email,
      hash,
      data.admin_name,
    );
    for (const t of DEFAULT_LEAVE_TYPES) {
      await run('INSERT INTO leave_types (code, name, yearly_quota, is_paid) VALUES (?, ?, ?, ?) ON CONFLICT (code) DO NOTHING', t.code, t.name, t.yearly_quota, t.is_paid);
    }
    await audit({ id: admin.id, name: data.admin_name, role: 'admin' }, 'setup.complete', 'settings', 1, null, {
      company_name: data.company_name,
      admin_email: data.admin_email,
    });
    return { ok: true };
  });
}
