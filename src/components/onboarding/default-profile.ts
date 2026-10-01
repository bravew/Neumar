import {
  DEFAULT_AVATAR,
  TEMPLATE_AVATARS,
} from '@/components/profiles/avatar-options';
import { API_BASE_URL } from '@/config';
import { randomUUID } from '@/shared/utils/uuid';

/**
 * Creates the default "General Helper" agent profile from the
 * `general-assistant` template and returns its id. QuickStart's skip path and
 * the simple-shell onboarding flow both finish with this profile.
 */
export async function createDefaultProfile(name: string): Promise<string> {
  const id = randomUUID();
  const avatar = TEMPLATE_AVATARS['general-assistant'] ?? DEFAULT_AVATAR;
  const createRes = await fetch(`${API_BASE_URL}/db/agent-profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      name,
      runtime_id: 'claude',
      avatar_icon: avatar.icon,
      avatar_color: avatar.color,
    }),
  });
  if (!createRes.ok) throw new Error('Failed to create default profile');

  const applyRes = await fetch(
    `${API_BASE_URL}/soul/agent-profiles/${id}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: 'general-assistant' }),
    },
  );
  if (!applyRes.ok) throw new Error('Failed to apply template');
  return id;
}
