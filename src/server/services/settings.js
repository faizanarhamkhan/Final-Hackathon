import { get, run, all, nowIso } from '../db/index.js';
import { parse, z, hhmm } from '../lib/validate.js';
import { isValidTimeZone, zonedNow, eachDay, dayOfWeek } from '../lib/dates.js';
import { unprocessable } from '../lib/http.js';
import { audit } from './audit.js';

export async function getSettings() {
  return get('SELECT * FROM settings WHERE id = 1');
}

export async function today() {
  return zonedNow((await getSettings()).timezone);
}

// Subset every signed-in user may see (no office coordinates).
export async function publicSettings() {
  const s = await getSettings();
  return {
    company_name: s.company_name,
    office_start: s.office_start,
    office_end: s.office_end,
    grace_minutes: s.grace_minutes,
    half_day_hours: s.half_day_hours,
    weekend_days: s.weekend_days,
    timezone: s.timezone,
    currency: s.currency,
    office_radius_m: s.office_radius_m,
    camera_attendance_enabled: s.office_lat != null && s.office_lng != null,
    late_penalty_enabled: s.late_penalty_enabled,
    today: zonedNow(s.timezone).date,
  };
}

const nullableNumber = (min, max) => z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable());

const settingsSchema = z
  .object({
    company_name: z.string().trim().min(2, 'Company name is required').max(120),
    office_start: hhmm,
    office_end: hhmm,
    grace_minutes: z.coerce.number().int().min(0).max(180),
    half_day_hours: z.coerce.number().min(1).max(12),
    weekend_days: z.array(z.coerce.number().int().min(0).max(6)).max(6),
    timezone: z.string().trim().refine(isValidTimeZone, 'Unknown time zone'),
    currency: z.string().trim().min(1).max(8),
    office_lat: nullableNumber(-90, 90),
    office_lng: nullableNumber(-180, 180),
    office_radius_m: z.coerce.number().int().min(20).max(5000),
    late_penalty_enabled: z.coerce.boolean(),
  })
  .partial();

// Rule changes only affect records created afterwards: each attendance record keeps
// the rules it was evaluated with, and payroll reads the stored statuses.
export async function updateSettings(actor, input) {
  const data = parse(settingsSchema, input);
  const before = await getSettings();
  const merged = { ...before, ...data };
  if (merged.office_start >= merged.office_end) {
    throw unprocessable('VALIDATION_ERROR', 'Office end must be after office start', [{ field: 'office_end', reason: 'Must be after start' }]);
  }
  if ((merged.office_lat == null) !== (merged.office_lng == null)) {
    throw unprocessable('VALIDATION_ERROR', 'Set both latitude and longitude, or clear both', [{ field: 'office_lat', reason: 'Both required' }]);
  }
  await run(
    `UPDATE settings SET company_name = ?, office_start = ?, office_end = ?, grace_minutes = ?, half_day_hours = ?,
       weekend_days = ?::jsonb, timezone = ?, currency = ?, office_lat = ?, office_lng = ?, office_radius_m = ?,
       late_penalty_enabled = ?, updated_at = ? WHERE id = 1`,
    merged.company_name,
    merged.office_start,
    merged.office_end,
    merged.grace_minutes,
    merged.half_day_hours,
    JSON.stringify([...new Set(merged.weekend_days)].sort()),
    merged.timezone,
    merged.currency,
    merged.office_lat,
    merged.office_lng,
    merged.office_radius_m,
    !!merged.late_penalty_enabled,
    nowIso(),
  );
  const after = await getSettings();
  await audit(actor, 'settings.update', 'settings', 1, before, after);
  return after;
}

// Working-day calendar for a date range (weekend days + public holidays).
export async function workCalendar(from, to) {
  const s = await getSettings();
  const weekend = new Set(s.weekend_days);
  const holidays = new Map((await all('SELECT date, name FROM holidays WHERE date BETWEEN ? AND ?', from, to)).map((h) => [h.date, h.name]));
  const isWorking = (d) => !weekend.has(dayOfWeek(d)) && !holidays.has(d);
  return {
    isWorking,
    holidayName: (d) => holidays.get(d) || null,
    isWeekend: (d) => weekend.has(dayOfWeek(d)),
    workingDays: (a = from, b = to) => (a > b ? 0 : eachDay(a, b).filter(isWorking).length),
  };
}
