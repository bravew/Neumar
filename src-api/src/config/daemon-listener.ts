export function daemonListenerConfig() {
  const remote = process.env.NEUMAR_REMOTE === 'true';
  if (remote && process.env.WEBUI_AUTH !== 'true') {
    throw new Error('NEUMAR_REMOTE=true requires WEBUI_AUTH=true');
  }
  if (
    process.env.WEBUI_AUTH === 'true' &&
    !process.env.WEBUI_JWT_SECRET?.trim()
  ) {
    throw new Error('WEBUI_AUTH=true requires WEBUI_JWT_SECRET');
  }
  return { hostname: remote ? '0.0.0.0' : '127.0.0.1', remote };
}
