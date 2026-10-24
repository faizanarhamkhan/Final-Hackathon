import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Readable one-time password, e.g. "Tmp-k7Qm2xPa94".
export function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(9);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `Tmp-${s}${bytes[0] % 10}`;
}
