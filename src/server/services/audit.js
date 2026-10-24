import { all, get, run } from '../db/index.js';

const SECRET_FIELDS = new Set(['password_hash', 'password', 'tempPassword', 'temp_password']);

function scrub(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (!SECRET_FIELDS.has(k)) out[k] = v;
  return out;
}

export async function audit(actor, action, entity, entityId = null, before = null, after = null) {
  await run(
    `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity, entity_id, before_json, after_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)`,
    actor?.id ?? null,
    actor?.name ?? 'System',
    actor?.role ?? 'system',
    action,
    entity,
    entityId == null ? null : String(entityId),
    before ? JSON.stringify(scrub(before)) : null,
    after ? JSON.stringify(scrub(after)) : null,
    actor?.ip ?? null,
  );
}

export async function listAudit({ entity, action, actor_id, from, to, page = 1, pageSize = 25 } = {}) {
  const where = [];
  const params = [];
  if (entity) (where.push('entity = ?'), params.push(entity));
  if (action) (where.push('action ILIKE ?'), params.push(`%${action}%`));
  if (actor_id) (where.push('actor_id = ?'), params.push(Number(actor_id)));
  if (from) (where.push('created_at >= ?'), params.push(`${from}T00:00:00Z`));
  if (to) (where.push('created_at <= ?'), params.push(`${to}T23:59:59Z`));
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const size = Math.min(100, Math.max(1, Number(pageSize) || 25));
  const p = Math.max(1, Number(page) || 1);
  const total = (await get(`SELECT COUNT(*) AS n FROM audit_logs ${clause}`, ...params)).n;
  const rows = (await all(`SELECT * FROM audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, size, (p - 1) * size)).map(
    ({ before_json, after_json, ...r }) => ({ ...r, before: before_json, after: after_json }),
  );
  const entities = (await all('SELECT DISTINCT entity FROM audit_logs ORDER BY entity')).map((r) => r.entity);
  return { rows, total, page: p, pageSize: size, pages: Math.max(1, Math.ceil(total / size)), entities };
}

export function recentAudit(limit = 8) {
  return all('SELECT id, actor_name, actor_role, action, entity, entity_id, created_at FROM audit_logs ORDER BY id DESC LIMIT ?', limit);
}
