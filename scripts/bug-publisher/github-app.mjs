// GitHub App installation-token exchange for #362's restricted publisher.
//
// Credentials are read from `PUBLISHER_APP_ID` and
// `PUBLISHER_APP_PRIVATE_KEY` in the supplied environment only. Nothing here
// reads a file, logs a token, or falls back to `GITHUB_TOKEN`. The tests use a
// throwaway generated key and an injected fetch; this module is never called
// with a real key by the test suite.

import { createSign } from 'node:crypto';

const API_VERSION = '2022-11-28';
const DEFAULT_API_BASE = 'https://api.github.com';
const USER_AGENT = 'neumar-bug-publisher';

/**
 * Installation-token permissions the publisher may hold. The token is issued
 * with the App's installed permissions, so this is an assertion over the
 * response rather than a request for narrower scopes.
 */
const ALLOWED_TOKEN_PERMISSIONS = Object.freeze({
  contents: Object.freeze(['write']),
  pull_requests: Object.freeze(['write']),
  issues: Object.freeze(['read', 'write']),
  metadata: Object.freeze(['read']),
});

function credentialsError(message) {
  const error = new Error(message);
  error.code = 'PUBLISHER_CREDENTIALS_INVALID';
  return error;
}

/** Read the two App credentials from the supplied environment, and nothing else. */
export function loadPublisherAppCredentials(env = process.env) {
  const rawAppId = env?.PUBLISHER_APP_ID;
  const rawKey = env?.PUBLISHER_APP_PRIVATE_KEY;
  const problems = [];
  if (typeof rawAppId !== 'string' || !/^\d+$/.test(rawAppId.trim())) {
    problems.push('PUBLISHER_APP_ID must be a numeric App id');
  }
  let privateKey = typeof rawKey === 'string' ? rawKey : '';
  if (privateKey.includes('\\n') && !privateKey.includes('\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  if (
    !privateKey.includes('-----BEGIN') ||
    !privateKey.includes('PRIVATE KEY-----') ||
    !privateKey.includes('-----END')
  ) {
    problems.push('PUBLISHER_APP_PRIVATE_KEY must be a PEM private key');
  }
  if (problems.length > 0) {
    throw credentialsError(problems.join('; '));
  }
  return Object.freeze({
    appId: rawAppId.trim(),
    privateKey,
  });
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

/** Build the short-lived RS256 JWT GitHub requires for App authentication. */
export function createAppJwt({ appId, privateKey, now }) {
  if (typeof appId !== 'string' || !/^\d+$/.test(appId)) {
    throw credentialsError('appId must be a numeric string');
  }
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    throw credentialsError('privateKey is required');
  }
  const issuedAt =
    typeof now === 'number' ? now : Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iat: issuedAt - 60,
      exp: issuedAt + 540,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

/** Reject a token whose permissions exceed the publisher's contract. */
export function assertAppTokenLeastPrivilege(permissions) {
  const violations = [];
  if (!permissions || typeof permissions !== 'object') {
    return {
      ok: false,
      violations: ['installation token has no permissions object'],
    };
  }
  for (const [name, level] of Object.entries(permissions)) {
    const allowed = ALLOWED_TOKEN_PERMISSIONS[name];
    if (!allowed) {
      violations.push(`installation token must not hold ${name}`);
      continue;
    }
    if (!allowed.includes(level)) {
      violations.push(`${name}: ${level} is too broad`);
    }
  }
  if (permissions.contents !== 'write') {
    violations.push('contents: write is required');
  }
  if (permissions.pull_requests !== 'write') {
    violations.push('pull_requests: write is required');
  }
  return { ok: violations.length === 0, violations };
}

const REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Reduce a repository input (`name` or `owner/name`) to the bare repository
 * name GitHub's `repositories` body field takes. The owner is implied by the
 * installation, so an `owner/name` input only contributes its name.
 */
function repositoryName(repository) {
  if (typeof repository !== 'string') {
    throw credentialsError('repository is required to scope the token');
  }
  const parts = repository.split('/');
  const name = parts[parts.length - 1];
  if (
    parts.length > 2 ||
    !REPOSITORY_NAME.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw credentialsError('repository must be a repository name');
  }
  return name;
}

/**
 * Exchange the App JWT for an installation access token scoped to one
 * repository. The response body is validated and the token is returned; it is
 * never logged.
 */
export async function exchangeInstallationToken({
  appId,
  privateKey,
  installationId,
  repository,
  fetchImpl = globalThis.fetch,
  now,
  apiBase = DEFAULT_API_BASE,
}) {
  if (
    !Number.isInteger(Number(installationId)) ||
    Number(installationId) <= 0
  ) {
    throw credentialsError('installationId must be a positive integer');
  }
  if (typeof fetchImpl !== 'function') {
    throw credentialsError('a fetch implementation is required');
  }
  const name = repositoryName(repository);
  const jwt = createAppJwt({ appId, privateKey, now });
  const response = await fetchImpl(
    `${apiBase}/app/installations/${Number(installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'X-GitHub-Api-Version': API_VERSION,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ repositories: [name] }),
    },
  );
  if (!response || response.ok !== true) {
    const status = response?.status ?? 'unknown';
    throw credentialsError(
      `installation token exchange failed with status ${status}`,
    );
  }
  const body = await response.json();
  if (!body || typeof body.token !== 'string' || body.token.length === 0) {
    throw credentialsError('installation token response has no token');
  }
  const leastPrivilege = assertAppTokenLeastPrivilege(body.permissions);
  if (!leastPrivilege.ok) {
    throw credentialsError(
      `installation token permissions are not least-privilege: ${leastPrivilege.violations.join('; ')}`,
    );
  }
  return {
    token: body.token,
    expiresAt: body.expires_at ?? null,
    permissions: body.permissions,
  };
}

/**
 * Convenience wrapper for a workflow step: the two App credentials come from
 * the environment; the installation id and the one repository the token may
 * touch are passed explicitly.
 */
export async function createInstallationTokenFromEnv({
  installationId,
  repository,
  env = process.env,
  fetchImpl,
  now,
  apiBase,
}) {
  const credentials = loadPublisherAppCredentials(env);
  return exchangeInstallationToken({
    ...credentials,
    installationId,
    repository,
    fetchImpl,
    now,
    apiBase,
  });
}
