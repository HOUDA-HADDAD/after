/**
 * The seed, re-exported.
 *
 * The data itself moved to `src/modules/themes/system-themes.ts` so the built image carries it:
 * the container runs migrations and then seeds on boot, and `prisma/` is not compiled into
 * `dist`. A deploy that migrated but never seeded came up with an empty theme picker and no way
 * to start a game — which is a broken deployment that every health check calls healthy.
 *
 * This file remains because `pnpm db:seed` and the test suites import from it.
 */
export { SYSTEM_THEMES, seedThemes } from '../src/modules/themes/system-themes.js';
