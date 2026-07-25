/**
 * Business logic must not reach into the database directly.
 *
 * Services own transactions and authorization; repositories own queries. When a service starts
 * calling `prisma.*` inline, query logic scatters, N+1s appear where nobody is looking for them,
 * and the layering in docs/01-architecture.md quietly stops being true.
 */

/** Paths permitted to touch Prisma directly. */
const ALLOWED_PATHS = [
  /\.repository\.(ts|js)$/,
  /[\\/]repositories?[\\/]/,
  /[\\/]plugins[\\/]prisma\.(ts|js)$/,
  /[\\/]prisma[\\/]/,
  /[\\/]tests?[\\/]/,
  /[\\/]__tests__[\\/]/,
  /\.(test|spec)\.(ts|js)$/,
  /[\\/]seed\.(ts|js)$/,
];

const PRISMA_MODULES = /^(@prisma\/client|\.prisma\/client|@aftergame\/db)/;

const isAllowed = (filename) => ALLOWED_PATHS.some((pattern) => pattern.test(filename));

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow importing or using the Prisma client outside repositories and the Prisma plugin',
    },
    schema: [],
    messages: {
      import:
        'Import Prisma only in a *.repository.ts file or the Prisma plugin. Move this query into a repository.',
      usage:
        'Use `prisma` only inside a repository. Services should call a repository method instead.',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isAllowed(filename)) return {};

    return {
      ImportDeclaration(node) {
        if (typeof node.source.value === 'string' && PRISMA_MODULES.test(node.source.value)) {
          context.report({ node, messageId: 'import' });
        }
      },

      // `prisma.user.findMany(...)`, `this.prisma.$transaction(...)`, `app.prisma...`
      MemberExpression(node) {
        const { object } = node;
        if (object.type === 'Identifier' && object.name === 'prisma') {
          context.report({ node, messageId: 'usage' });
          return;
        }
        if (
          object.type === 'MemberExpression' &&
          object.property.type === 'Identifier' &&
          object.property.name === 'prisma'
        ) {
          context.report({ node, messageId: 'usage' });
        }
      },
    };
  },
};
