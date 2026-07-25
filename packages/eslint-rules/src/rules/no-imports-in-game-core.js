/**
 * `@aftergame/game-core` stays pure.
 *
 * Every rule that matters in this product — distribution, punishment, phases, visibility — lives
 * in that package, and it is only exhaustively testable (10k+ generated cases, 100% branch
 * coverage) because it has no I/O, no clock and no ambient randomness. The moment something
 * imports a database client or calls `Date.now()`, the tests stop being deterministic and the
 * guarantee in docs/01-architecture.md quietly evaporates.
 *
 * Time and randomness are parameters here, never ambient.
 */

const GAME_CORE_SRC = /[\\/]packages[\\/]game-core[\\/]src[\\/]/;

const isRelative = (value) => typeof value === 'string' && value.startsWith('.');

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep game-core dependency-free and deterministic: relative imports only, no ambient time or randomness',
    },
    schema: [],
    messages: {
      externalImport:
        "game-core must stay dependency-free — '{{source}}' is external. Pass the value in as a parameter instead.",
      ambientRandom:
        'game-core must be deterministic. Use the injected seeded RNG (rng.ts), not Math.random().',
      ambientTime:
        'game-core must be deterministic. Accept `now` as a parameter rather than reading the clock.',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!GAME_CORE_SRC.test(filename)) return {};

    const reportAmbient = (node, messageId) => context.report({ node, messageId });

    return {
      ImportDeclaration(node) {
        if (!isRelative(node.source.value)) {
          context.report({
            node,
            messageId: 'externalImport',
            data: { source: String(node.source.value) },
          });
        }
      },

      'ImportExpression > Literal'(node) {
        if (!isRelative(node.value)) {
          context.report({
            node,
            messageId: 'externalImport',
            data: { source: String(node.value) },
          });
        }
      },

      MemberExpression(node) {
        const { object, property } = node;
        if (object.type !== 'Identifier' || property.type !== 'Identifier') return;

        if (object.name === 'Math' && property.name === 'random') {
          reportAmbient(node, 'ambientRandom');
        }
        if (object.name === 'Date' && property.name === 'now') {
          reportAmbient(node, 'ambientTime');
        }
      },

      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
          reportAmbient(node, 'ambientTime');
        }
      },
    };
  },
};
