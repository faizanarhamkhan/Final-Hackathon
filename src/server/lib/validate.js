import { z } from 'zod';
import { HttpError } from './http.js';
import { isISODate } from './dates.js';

export { z };

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.') || '(body)', reason: i.message }));
    throw new HttpError(422, 'VALIDATION_ERROR', details[0] ? `${details[0].field}: ${details[0].reason}` : 'Invalid input', details);
  }
  return result.data;
}

export const isoDate = z.string().trim().refine(isISODate, 'Use a valid date in YYYY-MM-DD format');
export const hhmm = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use time as HH:MM (24 hour)');
export const month = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use month as YYYY-MM');
export const id = z.coerce.number().int().positive();
export const optionalId = z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), id.optional());
export const optionalText = (max = 500) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');
