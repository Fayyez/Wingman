/** Build-time configuration (WXT exposes WXT_* env vars via import.meta.env). */
const env = import.meta.env as Record<string, string | boolean | undefined>;

export const API_URL = String(env.WXT_API_URL || 'http://localhost:8000').replace(/\/$/, '');
/** Dev login is only available in dev builds or when explicitly enabled. */
export const DEV_LOGIN = env.DEV === true || env.WXT_DEV_LOGIN === 'true';
export const GOOGLE_CLIENT_ID = String(env.WXT_GOOGLE_CLIENT_ID || '');
