import { PrismaClient } from '@prisma/client';
import { loadEnvFileIfPresent } from '@aftergame/config';
import { resolve } from 'node:path';
import { seedThemes } from './seed.js';

/**
 * Entry point for `pnpm db:seed`.
 *
 * Kept separate from `seed.ts` so tests can import `seedThemes` without a module that runs on
 * import — the seeding logic and the way we invoke it are different concerns.
 */
async function main(): Promise<void> {
  if (!loadEnvFileIfPresent(resolve(process.cwd(), '../../.env'))) {
    loadEnvFileIfPresent();
  }

  const prisma = new PrismaClient();

  try {
    const count = await seedThemes(prisma);
    console.warn(`Seeded ${String(count)} system themes.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
