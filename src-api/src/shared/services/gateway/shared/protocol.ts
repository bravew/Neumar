import { randomUUID } from 'node:crypto';

import { z } from 'zod';

export const EnvelopeTypeSchema = z.enum([
  'inbound',
  'outbound',
  'presence',
  'control',
  'error',
]);

export type EnvelopeType = z.infer<typeof EnvelopeTypeSchema>;

export const EnvelopeSchema = z.object({
  type: EnvelopeTypeSchema,
  channel: z.string().min(1),
  chatId: z.string().min(1),
  traceId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  payload: z.unknown(),
});

export type Envelope<T = unknown> = {
  type: EnvelopeType;
  channel: string;
  chatId: string;
  traceId: string;
  occurredAt?: string;
  payload: T;
};

export interface WrapInput<T> {
  type: EnvelopeType;
  channel: string;
  chatId: string;
  payload: T;
  traceId?: string;
  occurredAt?: string;
}

export function wrap<T>(input: WrapInput<T>): Envelope<T> {
  return {
    type: input.type,
    channel: input.channel,
    chatId: input.chatId,
    traceId: input.traceId ?? randomUUID(),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    payload: input.payload,
  };
}

export function isEnvelope(value: unknown): value is Envelope {
  return EnvelopeSchema.safeParse(value).success;
}
