export interface LarkTokenConfig {
  appId: string;
  appSecret: string;
  domain: 'lark' | 'feishu';
  verificationToken?: string;
  encryptKey?: string;
}

export function parseLarkTokenConfig(raw: string): LarkTokenConfig {
  const parsed = JSON.parse(raw) as Partial<LarkTokenConfig>;
  if (!parsed.appId || !parsed.appSecret) {
    throw new Error(
      'Lark token must be JSON: {"appId": "...", "appSecret": "..."}',
    );
  }
  return {
    appId: parsed.appId,
    appSecret: parsed.appSecret,
    domain: parsed.domain === 'feishu' ? 'feishu' : 'lark',
    ...(parsed.verificationToken
      ? { verificationToken: parsed.verificationToken }
      : {}),
    ...(parsed.encryptKey ? { encryptKey: parsed.encryptKey } : {}),
  };
}

export async function probeLarkStartup(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  appId: string;
  appSecret: string;
}): Promise<void> {
  await params.client.auth?.tenantAccessToken?.internal?.({
    data: {
      app_id: params.appId,
      app_secret: params.appSecret,
    },
  });
  // Surface bot-info failures (e.g. revoked permissions): if the tenant token
  // succeeds but bot info fails, first-message handling will be confusing.
  // Skip silently only when the SDK doesn't expose this method at all.
  if (typeof params.client.bot?.info?.get === 'function') {
    await params.client.bot.info.get();
  }
}

export function mapLarkStartupError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes('not published') || lower.includes('99991663')) {
    return new Error(
      'App not published — submit to admin or run as Test mode.',
    );
  }
  if (
    lower.includes('scope') ||
    lower.includes('permission') ||
    lower.includes('99991672')
  ) {
    return new Error(
      'Missing scope `im:message`. Add it in the developer console.',
    );
  }
  if (
    lower.includes('app secret') ||
    lower.includes('app_secret') ||
    lower.includes('99991661')
  ) {
    return new Error('Wrong app secret — confirm the Lark/Feishu app secret.');
  }
  if (
    lower.includes('websocket') ||
    lower.includes('long-connection') ||
    lower.includes('long connection')
  ) {
    return new Error(
      'Long-connection failed. Confirm Bot Capabilities are on.',
    );
  }
  return err instanceof Error ? err : new Error(message);
}
