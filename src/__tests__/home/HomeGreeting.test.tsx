import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeGreeting } from '@/components/home/HomeGreeting';

const testState = vi.hoisted(() => ({
  connection: {
    displayName: 'Ada Lovelace',
    accountEmail: 'ada@example.com',
  },
  nickname: 'Riley',
}));

vi.mock('@/shared/hooks/useAuth', () => ({
  useAuth: () => ({
    getConnection: () => testState.connection,
  }),
}));

vi.mock('@/shared/db/settings', () => ({
  useSettingsValue: () => ({
    profile: { nickname: testState.nickname },
  }),
}));

vi.mock('@/shared/providers/language-provider', () => ({
  useLanguage: () => ({
    tt: (key: string, params?: Record<string, string | number>) =>
      `${key}:${params?.name ?? ''}`,
  }),
}));

describe('HomeGreeting', () => {
  beforeEach(() => {
    testState.connection = {
      displayName: 'Ada Lovelace',
      accountEmail: 'ada@example.com',
    };
    testState.nickname = 'Riley';
  });

  it('uses the signed-in first name and the time-based greeting key', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 9, 9));

    render(<HomeGreeting />);

    expect(screen.getByRole('heading')).toHaveTextContent(
      'home.greeting.morning:Ada',
    );
  });

  it('falls back to the email local part when display name is unavailable', () => {
    testState.connection = {
      displayName: '',
      accountEmail: 'grace@example.com',
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 9, 20));

    render(<HomeGreeting />);

    expect(screen.getByRole('heading')).toHaveTextContent(
      'home.greeting.evening:grace',
    );
  });
});
