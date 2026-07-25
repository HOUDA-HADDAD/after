export { envSchema, loadEnv, EnvValidationError, EXAMPLE_SESSION_SECRET } from './env.js';
export type { Env } from './env.js';
export { loadEnvFileIfPresent } from './dotenv.js';

import type { Env } from './env.js';

export const isProduction = (env: Env): boolean => env.NODE_ENV === 'production';
export const isTest = (env: Env): boolean => env.NODE_ENV === 'test';
export const isDevelopment = (env: Env): boolean => env.NODE_ENV === 'development';
