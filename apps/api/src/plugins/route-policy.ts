import fp from 'fastify-plugin';
import type { FastifyPluginAsync, RouteOptions, preHandlerHookHandler } from 'fastify';
import type { RoutePolicy } from '../lib/authorize.js';

export interface DeclaredRoute {
  method: string;
  url: string;
  policy: RoutePolicy;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * What this route requires. Mandatory for every route under `/api` — the application
     * refuses to start without it.
     */
    policy?: RoutePolicy;
  }

  interface FastifyInstance {
    /** Every declared API route, for introspection and the meta-test. */
    routePolicies: DeclaredRoute[];
  }
}

/** Only our own API surface is subject to the rule; static assets are not an authorization surface. */
const isApiRoute = (url: string): boolean => url.startsWith('/api');

/**
 * Makes an unguarded route impossible.
 *
 * Every route under `/api` must declare `config.policy`. A route that does not is a **boot
 * failure**, not a lint warning and not a test that someone might not run — the server will not
 * start. Forgetting an authorization check is the single most common way an app like this leaks,
 * and the cheapest moment to catch it is before the process is listening.
 *
 * Declaring a policy other than `public` also attaches authentication automatically, so a route
 * cannot say "members only" and then forget to require a session.
 */
const routePolicyPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('routePolicies', [] as DeclaredRoute[]);

  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    if (!isApiRoute(routeOptions.url)) return;
    // HEAD is generated automatically alongside GET; it inherits the GET route's policy.
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    if (methods.every((method) => method === 'HEAD')) return;

    const policy = routeOptions.config?.policy;

    if (policy === undefined) {
      throw new Error(
        `Route ${methods.join('|')} ${routeOptions.url} does not declare config.policy. ` +
          `Every /api route must state what it requires — see src/lib/authorize.ts.`,
      );
    }

    app.routePolicies.push({ method: methods.join('|'), url: routeOptions.url, policy });

    if (policy === 'public') return;

    // Anything that is not public needs a session, without each route remembering to ask.
    const existing = routeOptions.preHandler;
    const preHandlers: preHandlerHookHandler[] =
      existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];

    const authenticate: preHandlerHookHandler = function authenticate(request, reply, done) {
      app.requireAuth(request, reply).then(
        () => {
          done();
        },
        (error: unknown) => {
          done(error as Error);
        },
      );
    };

    routeOptions.preHandler = [authenticate, ...preHandlers];
  });
};

export default fp(routePolicyPlugin, { name: 'route-policy', dependencies: ['auth'] });
