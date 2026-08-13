import { API_BASE_URL } from '@/config';

export async function respondToAgentPermission(
  permissionId: string,
  approved: boolean,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/agent/permission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissionId, approved }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}
