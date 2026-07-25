import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

/** A readiness probe returns true when its dependency is usable. */
export type ReadinessProbe = () => Promise<boolean>;

export interface ReadinessRegistry {
  /** Register a dependency the service needs before it can serve traffic. */
  add(name: string, probe: ReadinessProbe): void;
  /** Run every probe. Never throws — a probe that blows up is simply "not ready". */
  check(): Promise<{ ready: boolean; checks: Record<string, boolean> }>;
}

declare module 'fastify' {
  interface FastifyInstance {
    readiness: ReadinessRegistry;
  }
}

/**
 * Readiness as a registry rather than a hardcoded database ping.
 *
 * Phase 0 has no dependencies to probe, so `/readyz` reports ready with an empty check set.
 * Phase 1 adds the database probe here and nothing else changes.
 */
const readinessPlugin: FastifyPluginAsync = async (app) => {
  const probes = new Map<string, ReadinessProbe>();

  const registry: ReadinessRegistry = {
    add(name, probe) {
      probes.set(name, probe);
    },

    async check() {
      const checks: Record<string, boolean> = {};

      await Promise.all(
        [...probes].map(async ([name, probe]) => {
          try {
            checks[name] = await probe();
          } catch (error) {
            app.log.warn({ err: error, probe: name }, 'readiness probe failed');
            checks[name] = false;
          }
        }),
      );

      return { ready: Object.values(checks).every(Boolean), checks };
    },
  };

  app.decorate('readiness', registry);
};

export default fp(readinessPlugin, { name: 'readiness' });
