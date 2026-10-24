import { handle } from '@/server/api.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(request, { params }) {
  const { path } = await params;
  return handle(request, path);
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
