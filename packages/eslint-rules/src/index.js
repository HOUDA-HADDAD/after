/**
 * Aftergame's architectural invariants, expressed as lint rules.
 *
 * Each rule here exists because the alternative is catching the same mistake in code review
 * forever — and because two of the three are security controls, not style preferences.
 * See docs/02-tech-stack.md and docs/07-security.md.
 */
import noPrismaOutsideRepositories from './rules/no-prisma-outside-repositories.js';
import noImportsInGameCore from './rules/no-imports-in-game-core.js';
import noIdentityFieldsInDto from './rules/no-identity-fields-in-dto.js';

export const rules = {
  'no-prisma-outside-repositories': noPrismaOutsideRepositories,
  'no-imports-in-game-core': noImportsInGameCore,
  'no-identity-fields-in-dto': noIdentityFieldsInDto,
};

/** Flat-config plugin object. */
const plugin = {
  meta: { name: '@aftergame/eslint-rules', version: '0.1.0' },
  rules,
};

export default plugin;
