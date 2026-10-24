export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please sign in') => new HttpError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (code, message) => new HttpError(409, code, message);
export const unprocessable = (code, message, details) => new HttpError(422, code, message, details);
export const tooMany = (message) => new HttpError(429, 'RATE_LIMITED', message);

// Maps service and Postgres errors to { status, body } for the API layer.
export function toErrorPayload(err) {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  }
  const msg = String(err?.message || '');
  const pg = err?.code;
  if (pg === '23505') return { status: 409, body: { error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists' } } };
  if (pg === '23503') return { status: 409, body: { error: { code: 'IN_USE', message: 'This record is referenced by other records' } } };
  if (/finalized and locked/i.test(msg)) return { status: 409, body: { error: { code: 'PAYROLL_LOCKED', message: 'This payroll run is finalized and locked' } } };
  if (/immutable/i.test(msg)) return { status: 403, body: { error: { code: 'IMMUTABLE', message: 'Audit log entries cannot be changed' } } };
  console.error('[api error]', err);
  return { status: 500, body: { error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server' } } };
}
