export * from './agent-events';
export * from './desktop';
export * from './preferences';
export * from './sound';

import { sendOsNotification } from './desktop';

export async function sendTestNotification(
  title: string,
  body: string,
): Promise<boolean> {
  const result = await sendOsNotification(
    {
      runId: 'settings-test',
      kind: 'succeeded',
      title,
      body,
      data: { source: 'manual' },
    },
    { request: true, ignoreFocus: true, ignorePreference: true },
  );

  return result === 'shown';
}
