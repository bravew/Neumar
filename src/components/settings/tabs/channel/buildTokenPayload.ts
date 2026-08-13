import type { Platform } from './types';

/** Build a token string from credential fields, or undefined if nothing entered.
 *  Throws when only some required fields are filled (partial input). */
export function buildTokenPayload(
  platform: Platform,
  creds: Record<string, string>,
): string | undefined {
  if (platform === 'telegram' || platform === 'discord')
    return creds.token || undefined;
  if (platform === 'lark') {
    const hasId = !!creds.appId;
    const hasSecret = !!creds.appSecret;
    if (hasId && hasSecret)
      return JSON.stringify({ appId: creds.appId, appSecret: creds.appSecret });
    if (hasId !== hasSecret)
      throw new Error('Both App ID and App Secret are required for Lark');
    return undefined;
  }
  if (platform === 'slack') {
    const hasBot = !!creds.botToken;
    const hasApp = !!creds.appToken;
    if (hasBot && hasApp)
      return JSON.stringify({
        botToken: creds.botToken,
        appToken: creds.appToken,
      });
    if (hasBot !== hasApp)
      throw new Error('Both Bot Token and App Token are required for Slack');
    return undefined;
  }
  if (platform === 'imessage') {
    const hasUrl = !!creds.serverUrl;
    const hasPwd = !!creds.password;
    if (hasUrl && hasPwd)
      return JSON.stringify({
        serverUrl: creds.serverUrl,
        password: creds.password,
      });
    if (hasUrl !== hasPwd)
      throw new Error(
        'Both BlueBubbles server URL and password are required for iMessage',
      );
    return undefined;
  }
  if (platform === 'whatsapp') {
    return JSON.stringify({ acknowledged: true });
  }
  return undefined;
}
