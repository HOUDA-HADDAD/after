import type { PunishmentEventWithNames } from './punishments.repository.js';

export interface PunishmentEventDto {
  id: string;
  action: 'PUNISH' | 'FORGIVE' | 'AUTO_RESET';
  targetUserId: string;
  targetUsername: string;
  /** Null once the acting account is deleted — the record outlives the person who made it. */
  actorUsername: string | null;
  resultingLevel: number;
  reason: string | null;
  createdAt: string;
}

export const toPunishmentEventDto = (event: PunishmentEventWithNames): PunishmentEventDto => ({
  id: event.id,
  action: event.action,
  targetUserId: event.targetUser.id,
  targetUsername: event.targetUser.username,
  actorUsername: event.actorUser?.username ?? null,
  resultingLevel: event.resultingLevel,
  reason: event.reason,
  createdAt: event.createdAt.toISOString(),
});

export const punishmentEventJsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    action: { type: 'string' },
    targetUserId: { type: 'string' },
    targetUsername: { type: 'string' },
    actorUsername: { type: ['string', 'null'] },
    resultingLevel: { type: 'integer' },
    reason: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
  required: [
    'id',
    'action',
    'targetUserId',
    'targetUsername',
    'actorUsername',
    'resultingLevel',
    'reason',
    'createdAt',
  ],
  additionalProperties: false,
} as const;

export const punishmentHistoryJsonSchema = {
  type: 'object',
  properties: { events: { type: 'array', items: punishmentEventJsonSchema } },
  required: ['events'],
  additionalProperties: false,
} as const;
