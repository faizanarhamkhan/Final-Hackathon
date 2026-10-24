// Next.js loads .env / .env.local automatically; tests set process.env directly.
const env = process.env;

export const config = {
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: env.PGLITE_DIR || '.data/pglite',
  jwtSecret: env.JWT_SECRET || '',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '12h',
  admin: {
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
    company: env.COMPANY_NAME || '',
  },
  ai: {
    apiKey: env.AI_API_KEY || '',
    baseUrl: (env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    model: env.AI_MODEL || 'llama-3.3-70b-versatile',
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 15000,
    ratePerHour: Number(env.AI_RATE_LIMIT_PER_HOUR) || 20,
  },
};
