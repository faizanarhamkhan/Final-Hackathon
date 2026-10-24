// Boots the real API handler against an in-memory Postgres (PGlite) for each test file.
process.env.PGLITE_DIR = 'memory://';
process.env.DATABASE_URL = '';
process.env.AI_API_KEY = '';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

const { handle } = await import('../src/server/api.js');
export const { setNow } = await import('../src/server/lib/dates.js');
export const { closeDb } = await import('../src/server/db/index.js');

export async function api(method, path, { token, body } = {}) {
  const [p, qs] = path.split('?');
  const req = new Request(`http://test/api/${p}${qs ? `?${qs}` : ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handle(req, p.split('/'));
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, data, type };
}

// Signs in and, when the login has a temporary password, changes it.
export async function signIn(email, password, newPassword = 'NewPass123') {
  const r = await api('POST', 'auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.data)}`);
  if (!r.data.user.must_change_password) return r.data.token;
  const c = await api('POST', 'auth/change-password', { token: r.data.token, body: { current_password: password, new_password: newPassword } });
  if (c.status !== 200) throw new Error(`password change failed: ${JSON.stringify(c.data)}`);
  return c.data.token;
}
