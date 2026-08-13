import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_JSON_LIMITS,
  ConnectorJsonError,
  normalizeConnectorToolOutput,
  validateConnectorToolInput,
} from '@/shared/connectors/bounded-json';

describe('connector bounded JSON helpers', () => {
  it('validates connector input against common JSON Schema constraints', () => {
    const schema = {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    };

    expect(
      validateConnectorToolInput({ query: 'neuma', limit: 10 }, schema),
    ).toEqual({ query: 'neuma', limit: 10 });

    expect(() => validateConnectorToolInput({ limit: 10 }, schema)).toThrow(
      ConnectorJsonError,
    );
    expect(() =>
      validateConnectorToolInput(
        { query: 'neuma', limit: 10, token: 'x' },
        schema,
      ),
    ).toThrow(/forbidden credential-like key/);
    expect(() =>
      validateConnectorToolInput(
        { query: 'neuma', limit: 10, extra: true },
        schema,
      ),
    ).toThrow(/unsupported field/);
    expect(() =>
      validateConnectorToolInput({ query: 'neuma', limit: 1.5 }, schema),
    ).toThrow(/integer/);
  });

  it('allows union schema branches without applying unrelated constraints', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: ['string', 'null'], minLength: 1 },
      },
    };

    expect(validateConnectorToolInput({ query: null }, schema)).toEqual({
      query: null,
    });
  });

  it('redacts and truncates connector output instead of throwing', () => {
    const result = normalizeConnectorToolOutput({
      message: 'x'.repeat(CONNECTOR_JSON_LIMITS.maxStringBytes + 10),
      access_token: 'secret',
      items: Array.from(
        { length: CONNECTOR_JSON_LIMITS.maxArrayLength + 1 },
        (_, index) => index,
      ),
    });

    expect(result.truncated).toBe(true);
    expect(result.output).toMatchObject({
      access_token: '[redacted]',
    });
    const output = result.output as {
      message: string;
      items: number[];
    };
    expect(output.message.endsWith('...[truncated]')).toBe(true);
    expect(output.items).toHaveLength(CONNECTOR_JSON_LIMITS.maxArrayLength);
  });
});
