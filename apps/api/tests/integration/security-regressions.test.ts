import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { io, type Socket } from 'socket.io-client';
import { buildTestApp } from '../helpers/build-test-app.js';
import { registerUser, asUser, TEST_COOKIE_NAME } from '../helpers/auth.js';
import { testPrisma, resetDatabase } from '../helpers/prisma.js';

describe('security audit regressions', () => {
  let app: FastifyInstance;
  const sockets: Socket[] = [];
  beforeEach(async () => {
    await resetDatabase(testPrisma());
    ({ app } = await buildTestApp());
    await app.ready();
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await app.close();
  });

  it('rejects malformed resource IDs without a database error and disables API caching', async () => {
    const user = await registerUser(app);
    const response = await app.inject(asUser(user.token, { method: 'GET', url: '/api/v1/groups/not-a-uuid' }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects cross-site browser mutations even when Origin is missing', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(response.statusCode).toBe(403);
  });

  const connect = async (token: string, origin = 'http://localhost:5173'): Promise<Socket> => {
    if (app.server.address() === null) await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('No listening address');
    const socket = io(`http://127.0.0.1:${String(address.port)}`, {
      transports: ['websocket'], reconnection: false,
      extraHeaders: { cookie: `${TEST_COOKIE_NAME}=${token}`, origin },
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  };

  it('rejects a cross-origin WebSocket handshake and malformed cookies', async () => {
    const user = await registerUser(app);
    await expect(connect(user.token, 'https://evil.example')).rejects.toThrow();
    await expect(connect('%ZZ')).rejects.toThrow();
  });

  it.each(['logout', 'expiry', 'membership'] as const)('stops existing socket delivery after %s revocation', async (reason) => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const group = await app.groups.create(owner.userId, 'Salon');
    await app.invitations.redeem((await app.invitations.list(group.id, owner.userId))[0]!.code, member.userId);
    const socket = await connect(member.token);
    socket.emit('subscribe:group', group.id);
    await expect.poll(() => app.io.sockets.adapter.rooms.get(`group:${group.id}`)?.size).toBe(1);
    const received: unknown[] = [];
    socket.on('group:changed', payload => received.push(payload));
    app.events.emit('group.session_changed', { groupId: group.id });
    await expect.poll(() => received.length).toBe(1);
    if (reason === 'logout') await app.auth.logout(member.token);
    if (reason === 'expiry') await testPrisma().authSession.updateMany({ where: { userId: member.userId }, data: { expiresAt: new Date(0) } });
    if (reason === 'membership') await app.memberships.remove(group.id, owner.userId, member.userId);
    app.events.emit('group.session_changed', { groupId: group.id });
    await expect.poll(() => app.io.sockets.adapter.rooms.get(`group:${group.id}`)?.size ?? 0).toBe(0);
    expect(received).toHaveLength(1);
  });
});
