import { API_BASE_URL } from '@/config';

export interface CustomPetSummary {
  id: string;
  displayName: string;
  description: string;
  spritesheetUrl: string;
  spritesheetExt: string;
  sourceUrl?: string;
  hatchedAt: number;
}

export interface CustomPetsResponse {
  pets: CustomPetSummary[];
  rootDir: string;
}

export interface CommunityPetSummary {
  id: string;
  displayName: string;
  description: string;
  thumbnailUrl?: string;
  spritesheetUrl: string;
  sourceUrl: string;
  category?: string;
  original?: boolean;
  featured?: boolean;
}

export interface CommunityPetsResponse {
  pets: CommunityPetSummary[];
  page: number;
  pageCount: number;
  total: number;
  rootDir: string;
}

export interface CommunityPetInstallResponse {
  pet: CustomPetSummary;
  installed: boolean;
  rootDir: string;
}

export async function fetchCustomPets(
  signal?: AbortSignal,
): Promise<CustomPetsResponse> {
  const response = await fetch(`${API_BASE_URL}/pets/custom`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as CustomPetsResponse;
}

export async function fetchCommunityPets(
  signal?: AbortSignal,
): Promise<CommunityPetsResponse> {
  const response = await fetch(`${API_BASE_URL}/pets/community?limit=48`, {
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as CommunityPetsResponse;
}

export async function installCommunityPet(
  id: string,
): Promise<CommunityPetInstallResponse> {
  const response = await fetch(`${API_BASE_URL}/pets/community/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as CommunityPetInstallResponse;
}
