import { all, get, run, nowIso } from '../db/index.js';
import { parse, z } from '../lib/validate.js';
import { forbidden, notFound } from '../lib/http.js';
import { audit } from './audit.js';

// ---- Notifications ----

export async function notifyUser(userId, title, body = null, link = null) {
  if (!userId) return;
  await run('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)', userId, title, body, link);
}

export async function notifyEmployee(employeeId, title, body, link) {
  const u = await get('SELECT id FROM users WHERE employee_id = ? AND is_active', employeeId);
  if (u) await notifyUser(u.id, title, body, link);
}

export async function notifyRole(role, title, body, link, exceptUserId = null) {
  for (const u of await all('SELECT id FROM users WHERE role = ? AND is_active', role)) {
    if (u.id !== exceptUserId) await notifyUser(u.id, title, body, link);
  }
}

export async function listNotifications(actor, { limit = 30 } = {}) {
  const rows = await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', actor.id, Math.min(100, Number(limit) || 30));
  const unread = (await get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', actor.id)).n;
  return { rows, unread };
}

export async function markRead(actor, id) {
  const n = await get('SELECT * FROM notifications WHERE id = ?', id);
  if (!n) throw notFound('Notification not found');
  if (n.user_id !== actor.id) throw forbidden();
  await run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?', nowIso(), id);
  return { ok: true };
}

export async function markAllRead(actor) {
  await run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), actor.id);
  return { ok: true };
}

// ---- Announcements ----

export function listAnnouncements({ limit = 20 } = {}) {
  return all(
    `SELECT a.*, u.name AS author_name, u.role AS author_role
       FROM announcements a LEFT JOIN users u ON u.id = a.author_id
      ORDER BY a.id DESC LIMIT ?`,
    Math.min(100, Number(limit) || 20),
  );
}

const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Title is required').max(150),
  body: z.string().trim().min(3, 'Message is required').max(4000),
});

export async function createAnnouncement(actor, input) {
  const data = parse(announcementSchema, input);
  const row = await get('INSERT INTO announcements (title, body, author_id) VALUES (?, ?, ?) RETURNING *', data.title, data.body, actor.id);
  await run(
    `INSERT INTO notifications (user_id, title, body, link)
     SELECT id, ?, ?, '/announcements' FROM users WHERE is_active AND id != ?`,
    `Announcement: ${data.title}`,
    data.body.slice(0, 140),
    actor.id,
  );
  await audit(actor, 'announcement.create', 'announcement', row.id, null, row);
  return row;
}

export async function deleteAnnouncement(actor, id) {
  const row = await get('SELECT * FROM announcements WHERE id = ?', id);
  if (!row) throw notFound('Announcement not found');
  if (actor.role !== 'admin' && row.author_id !== actor.id) throw forbidden('Only the author or an Admin can remove this');
  await run('DELETE FROM announcements WHERE id = ?', id);
  await audit(actor, 'announcement.delete', 'announcement', id, row, null);
  return { ok: true };
}
