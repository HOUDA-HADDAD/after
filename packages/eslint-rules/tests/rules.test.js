import { RuleTester } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, it, expect } from 'vitest';
import { rules } from '../src/index.js';

// Wire ESLint's RuleTester to Vitest's runner.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = () => {};

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
});

/** `import type` is TypeScript syntax, so those cases need the TS parser. */
const tsRuleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2023, sourceType: 'module' },
});

const api = (p) => `/repo/apps/api/src/${p}`;
const core = (p) => `/repo/packages/game-core/src/${p}`;

describe('no-prisma-outside-repositories', () => {
  ruleTester.run('no-prisma-outside-repositories', rules['no-prisma-outside-repositories'], {
    valid: [
      {
        code: `import { PrismaClient } from '@prisma/client'; export const find = () => prisma.user.findMany();`,
        filename: api('modules/groups/groups.repository.ts'),
      },
      {
        code: `import { PrismaClient } from '@prisma/client';`,
        filename: api('plugins/prisma.ts'),
      },
      {
        code: `export const listGroups = (repo) => repo.findAllForUser();`,
        filename: api('modules/groups/groups.service.ts'),
      },
    ],
    invalid: [
      {
        code: `import { PrismaClient } from '@prisma/client';`,
        filename: api('modules/groups/groups.service.ts'),
        errors: [{ messageId: 'import' }],
      },
      {
        code: `export const listGroups = () => prisma.group.findMany();`,
        filename: api('modules/groups/groups.service.ts'),
        errors: [{ messageId: 'usage' }],
      },
      {
        code: `export const run = (app) => app.prisma.$transaction([]);`,
        filename: api('modules/sessions/sessions.service.ts'),
        errors: [{ messageId: 'usage' }],
      },
    ],
  });
});

describe('no-prisma-outside-repositories: type-only imports', () => {
  tsRuleTester.run('no-prisma-outside-repositories', rules['no-prisma-outside-repositories'], {
    valid: [
      // Types are erased at compile time and cannot touch the database, so a service naming an
      // entity is fine — otherwise the rule would force `any` at every layer boundary.
      {
        code: `import type { PrismaClient } from '@prisma/client';`,
        filename: api('app.ts'),
      },
      {
        code: `import { type Group, type Prisma } from '@prisma/client';`,
        filename: api('modules/groups/groups.service.ts'),
      },
    ],
    invalid: [
      // A mixed import still brings the runtime client in.
      {
        code: `import { PrismaClient, type Group } from '@prisma/client';`,
        filename: api('modules/groups/groups.service.ts'),
        errors: [{ messageId: 'import' }],
      },
    ],
  });
});

describe('no-imports-in-game-core', () => {
  ruleTester.run('no-imports-in-game-core', rules['no-imports-in-game-core'], {
    valid: [
      { code: `import { seededRng } from './rng.js';`, filename: core('distribution.ts') },
      {
        code: `export const pick = (rng) => rng.next();`,
        filename: core('distribution.ts'),
      },
      // Outside game-core these are all perfectly fine.
      {
        code: `import { PrismaClient } from '@prisma/client'; const t = Date.now();`,
        filename: api('modules/sessions/sessions.service.ts'),
      },
    ],
    invalid: [
      {
        code: `import { z } from 'zod';`,
        filename: core('phases.ts'),
        errors: [{ messageId: 'externalImport' }],
      },
      {
        code: `export const shuffle = () => Math.random();`,
        filename: core('rng.ts'),
        errors: [{ messageId: 'ambientRandom' }],
      },
      {
        code: `export const stamp = () => Date.now();`,
        filename: core('phases.ts'),
        errors: [{ messageId: 'ambientTime' }],
      },
      {
        code: `export const stamp = () => new Date();`,
        filename: core('phases.ts'),
        errors: [{ messageId: 'ambientTime' }],
      },
    ],
  });
});

describe('no-identity-fields-in-dto', () => {
  ruleTester.run('no-identity-fields-in-dto', rules['no-identity-fields-in-dto'], {
    valid: [
      {
        code: `export const toDto = (t) => ({ id: t.id, body: t.body, author: null });`,
        filename: api('modules/texts/texts.mapper.ts'),
      },
      // visibility.ts is the sanctioned place to reason about identity.
      {
        code: `export const project = (t, entitled) => ({ author: entitled ? t.authorPlayerId : null });`,
        filename: core('visibility.ts'),
      },
      // A service is not a DTO builder; this rule does not police it.
      {
        code: `export const load = (t) => t.authorPlayerId;`,
        filename: api('modules/texts/texts.service.ts'),
      },
    ],
    invalid: [
      {
        code: `export const toDto = (t) => ({ id: t.id, authorId: t.authorId });`,
        filename: api('modules/texts/texts.mapper.ts'),
        // once for the property key, once for the member read
        errors: [{ messageId: 'banned' }, { messageId: 'banned' }],
      },
      {
        code: `export const toDto = (v) => ({ decided: v.length, choice: v.choice });`,
        filename: api('modules/reveal/reveal.mapper.ts'),
        errors: [{ messageId: 'banned' }, { messageId: 'banned' }],
      },
      {
        code: `export const toDto = (a) => ({ 'receiverPlayerId': a.receiver });`,
        filename: api('modules/answers/answers.mapper.ts'),
        errors: [{ messageId: 'banned' }],
      },
    ],
  });
});

describe('plugin shape', () => {
  it('exports all three rules', () => {
    expect(Object.keys(rules).sort()).toEqual([
      'no-identity-fields-in-dto',
      'no-imports-in-game-core',
      'no-prisma-outside-repositories',
    ]);
  });
});
