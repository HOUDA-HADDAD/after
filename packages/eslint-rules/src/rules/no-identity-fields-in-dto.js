/**
 * Identity must not leak through a DTO.
 *
 * This is a security control, not a style rule. Anonymity is the product: if an author id reaches
 * the client — even unused, even hidden by CSS — the game is over. docs/01-architecture.md puts
 * every payload through one projection function; this rule makes sure nothing quietly grows a
 * second path.
 *
 * The sanctioned exception is game-core/visibility.ts, which is the projection itself.
 */

/** Files that assemble client-facing payloads. */
const DTO_PATHS = [
  /\.mapper\.(ts|js)$/,
  /\.dto\.(ts|js)$/,
  /[\\/]dto[\\/]/,
  /[\\/]mappers?[\\/]/,
  /[\\/]presenters?[\\/]/,
];

/** The one module allowed to know about identity, because deciding is its job. */
const SANCTIONED = [
  /[\\/]game-core[\\/]src[\\/]visibility\.(ts|js)$/,
  /[\\/]tests?[\\/]/,
  /[\\/]__tests__[\\/]/,
  /\.(test|spec)\.(ts|js)$/,
];

/**
 * Fields that identify a player, or that decide whether identity may be shown.
 * `choice` and `revealVote` are here because the reveal tally must never be serialized
 * (docs/00-spec-decisions.md D8a) — not even as a count.
 */
const BANNED_FIELDS = new Set([
  'authorId',
  'authorPlayerId',
  'receiverPlayerId',
  'guesserPlayerId',
  'guessedPlayerId',
  'revealVote',
  'revealVotes',
  'choice',
]);

const matchesAny = (patterns, filename) => patterns.some((pattern) => pattern.test(filename));

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow player-identity and reveal-vote fields in DTO builders; only game-core/visibility.ts may decide identity',
    },
    schema: [],
    messages: {
      banned:
        "'{{field}}' must not appear in a client-facing payload. Route it through game-core/visibility.ts, which decides what the viewer is entitled to see.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (matchesAny(SANCTIONED, filename)) return {};
    if (!matchesAny(DTO_PATHS, filename)) return {};

    const report = (node, field) => context.report({ node, messageId: 'banned', data: { field } });

    return {
      Property(node) {
        const { key } = node;
        if (key.type === 'Identifier' && BANNED_FIELDS.has(key.name)) {
          report(node, key.name);
        }
        if (
          key.type === 'Literal' &&
          typeof key.value === 'string' &&
          BANNED_FIELDS.has(key.value)
        ) {
          report(node, key.value);
        }
      },

      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === 'Identifier' &&
          BANNED_FIELDS.has(node.property.name)
        ) {
          report(node, node.property.name);
        }
      },
    };
  },
};
