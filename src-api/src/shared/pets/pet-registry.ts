import { randomUUID } from 'node:crypto';
import type { LookupAddress } from 'node:dns';
import dns from 'node:dns/promises';
import type { Dirent } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { classifyIp } from '@/shared/network-policy/ip';

const OPENPETS_INDEX_URL = 'https://openpets.dev/pets/catalog.v3.json';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_JSON_BYTES = 512_000;
const MAX_SPRITESHEET_BYTES = 8 * 1024 * 1024;
const ALLOWED_COMMUNITY_HOSTS = new Set(['openpets.dev']);
const SPRITESHEET_NAMES = [
  'spritesheet.webp',
  'spritesheet.png',
  'spritesheet.gif',
] as const;
const SUPPORTED_SPRITESHEET_EXTS = new Set(['webp', 'png', 'gif']);
// PNG file magic — defined at module scope so the byte-by-byte signature check
// in validateImageBytes doesn't allocate a fresh array per iteration.
const PNG_MAGIC = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

export interface CustomPetSummary {
  id: string;
  displayName: string;
  description: string;
  spritesheetUrl: string;
  spritesheetExt: string;
  sourceUrl?: string;
  hatchedAt: number;
}

export interface CustomPetListResult {
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

export interface CommunityPetListResult {
  pets: CommunityPetSummary[];
  page: number;
  pageCount: number;
  total: number;
  rootDir: string;
}

export interface CommunityPetInstallResult {
  pet: CustomPetSummary;
  installed: boolean;
  rootDir: string;
}

interface PetManifest {
  displayName?: unknown;
  description?: unknown;
  spritesheetPath?: unknown;
  sourceUrl?: unknown;
}

interface SpritesheetPick {
  absPath: string;
  ext: string;
}

interface RegistryOptions {
  rootDir?: string;
}

interface FetchOptions extends RegistryOptions {
  fetchImpl?: typeof fetch;
}

interface OpenPetsIndex {
  total?: number;
  pages?: string[];
  search?: string;
}

interface OpenPetsSearchIndex {
  pages?: string[];
}

interface OpenPetsSearchPet {
  id?: string;
  catalogPage?: number;
}

interface OpenPetsSearchPage {
  pets?: OpenPetsSearchPet[];
}

interface OpenPetsCatalogPet {
  id?: string;
  displayName?: string;
  description?: string;
  thumbnail?: string;
  spritesheet?: string;
  category?: string;
  original?: boolean;
  featured?: boolean;
}

interface OpenPetsCatalogPage {
  pets?: OpenPetsCatalogPet[];
}

export function resolveCustomPetsRoot(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  const home = codexHome || path.join(os.homedir(), '.codex');
  return path.join(home, 'pets');
}

export function sanitizePetId(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
}

export async function listCustomPets(
  options: RegistryOptions & { baseUrl?: string } = {},
): Promise<CustomPetListResult> {
  const rootDir = options.rootDir ?? resolveCustomPetsRoot();
  const baseUrl = options.baseUrl ?? '';
  const pets: CustomPetSummary[] = [];
  const seen = new Set<string>();
  let entries: Dirent[] = [];

  try {
    entries = await readdir(rootDir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return { pets, rootDir };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const id = sanitizePetId(entry.name);
    if (!id || seen.has(id)) continue;

    const dir = path.join(rootDir, entry.name);
    const manifest = await readPetManifest(dir);
    const sheet = await pickSpritesheet(dir, manifest);
    if (!sheet) continue;

    seen.add(id);
    const sheetStat = await stat(sheet.absPath).catch(() => null);
    pets.push({
      id,
      displayName: pickString(manifest.displayName) ?? prettyName(id),
      description: pickString(manifest.description) ?? '',
      spritesheetUrl: `${baseUrl}/pets/custom/${encodeURIComponent(id)}/spritesheet`,
      spritesheetExt: sheet.ext,
      ...(pickString(manifest.sourceUrl)
        ? { sourceUrl: pickString(manifest.sourceUrl) }
        : {}),
      hatchedAt: Math.floor(sheetStat?.mtimeMs ?? 0),
    });
  }

  pets.sort((a, b) => b.hatchedAt - a.hatchedAt);
  return { pets, rootDir };
}

export async function readCustomPetSpritesheet(
  id: string,
  options: RegistryOptions = {},
): Promise<SpritesheetPick | null> {
  const rootDir = options.rootDir ?? resolveCustomPetsRoot();
  const dir = await resolvePetDir(rootDir, id);
  if (!dir) return null;

  return pickSpritesheet(dir, await readPetManifest(dir));
}

export async function listCommunityPets(
  options: FetchOptions & { page?: number; limit?: number } = {},
): Promise<CommunityPetListResult> {
  const index = await getCommunityIndex(options);
  const pages = index.pages ?? [];
  const page = clampPage(options.page ?? 0, pages.length);
  const pageUrl = pages[page];
  if (!pageUrl) {
    return {
      pets: [],
      page,
      pageCount: pages.length,
      total: index.total ?? 0,
      rootDir: options.rootDir ?? resolveCustomPetsRoot(),
    };
  }

  const payload = (await fetchJson(pageUrl, options)) as OpenPetsCatalogPage;
  const requestedLimit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? options.limit
      : 48;
  const limit = Math.min(Math.max(requestedLimit, 1), 100);
  const pets = (payload.pets ?? [])
    .map(toCommunityPetSummary)
    .filter((pet): pet is CommunityPetSummary => Boolean(pet))
    .slice(0, limit);

  return {
    pets,
    page,
    pageCount: pages.length,
    total: index.total ?? pets.length,
    rootDir: options.rootDir ?? resolveCustomPetsRoot(),
  };
}

export async function installCommunityPet(
  id: string,
  options: FetchOptions & { force?: boolean } = {},
): Promise<CommunityPetInstallResult> {
  const rootDir = options.rootDir ?? resolveCustomPetsRoot();
  const pet = await findCommunityPet(id, options);
  if (!pet) throw new Error(`Community pet not found: ${id}`);

  const folder = sanitizePetId(pet.id);
  if (!folder) throw new Error('Invalid pet id');

  const ext = extOf(pet.spritesheetUrl);
  const dir = path.join(rootDir, folder);
  const sheetPath = path.join(dir, `spritesheet.${ext}`);
  const manifestPath = path.join(dir, 'pet.json');

  const existing = await hasCompletePet(sheetPath, manifestPath);
  if (existing && !options.force) {
    const listed = await listCustomPets({ rootDir });
    const installedPet = listed.pets.find(
      (candidate) => candidate.id === folder,
    );
    if (installedPet) {
      return { pet: installedPet, installed: false, rootDir };
    }
  }

  const bytes = await downloadSpritesheet(pet.spritesheetUrl, options);
  validateImageBytes(bytes, ext);

  await mkdir(dir, { recursive: true });

  const tmpPath = `${sheetPath}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, sheetPath);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        id: pet.id,
        displayName: pet.displayName,
        description: pet.description,
        spritesheetPath: `spritesheet.${ext}`,
        author: 'OpenPets',
        source: 'openpets-community',
        sourceUrl: pet.sourceUrl,
        category: pet.category,
        original: pet.original,
        featured: pet.featured,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const listed = await listCustomPets({ rootDir });
  const installedPet = listed.pets.find((candidate) => candidate.id === folder);
  if (!installedPet) throw new Error(`Installed pet not readable: ${folder}`);

  return { pet: installedPet, installed: true, rootDir };
}

export function contentTypeForSpritesheet(ext: string): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  return 'image/webp';
}

async function readPetManifest(dir: string): Promise<PetManifest> {
  try {
    const raw = await readFile(path.join(dir, 'pet.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PetManifest;
    }
  } catch {
    // Manifest is optional for manually dropped pets.
  }
  return {};
}

async function pickSpritesheet(
  dir: string,
  manifest: PetManifest,
): Promise<SpritesheetPick | null> {
  const candidates: string[] = [];
  const declaredPath = pickString(manifest.spritesheetPath);

  if (declaredPath) {
    const abs = path.resolve(dir, declaredPath);
    const rel = path.relative(dir, abs);
    if (
      rel &&
      !rel.startsWith('..') &&
      !path.isAbsolute(rel) &&
      isSupportedSpritesheetPath(abs)
    ) {
      candidates.push(abs);
    }
  }

  for (const name of SPRITESHEET_NAMES) {
    candidates.push(path.join(dir, name));
  }

  for (const absPath of candidates) {
    try {
      const fileStat = await stat(absPath);
      if (!fileStat.isFile()) continue;
      const ext = path.extname(absPath).slice(1).toLowerCase() || 'webp';
      if (!SUPPORTED_SPRITESHEET_EXTS.has(ext)) continue;
      return {
        absPath,
        ext,
      };
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

function isSupportedSpritesheetPath(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return SUPPORTED_SPRITESHEET_EXTS.has(ext);
}

async function resolvePetDir(
  rootDir: string,
  id: string,
): Promise<string | null> {
  const safeId = sanitizePetId(id);
  if (!safeId) return null;

  let entries: Dirent[] = [];
  try {
    entries = await readdir(rootDir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return null;
  }

  const entry = entries.find(
    (candidate) =>
      candidate.isDirectory() && sanitizePetId(candidate.name) === safeId,
  );
  return entry ? path.join(rootDir, entry.name) : null;
}

async function getCommunityIndex(
  options: FetchOptions,
): Promise<OpenPetsIndex> {
  return (await fetchJson(OPENPETS_INDEX_URL, options)) as OpenPetsIndex;
}

async function findCommunityPet(
  id: string,
  options: FetchOptions,
): Promise<CommunityPetSummary | null> {
  const safeId = sanitizePetId(id);
  if (!safeId) return null;

  const index = await getCommunityIndex(options);
  const searchUrl = pickString(index.search);
  if (!searchUrl) return null;

  const searchIndex = (await fetchJson(
    searchUrl,
    options,
  )) as OpenPetsSearchIndex;

  for (const searchPageUrl of searchIndex.pages ?? []) {
    const searchPage = (await fetchJson(
      searchPageUrl,
      options,
    )) as OpenPetsSearchPage;
    const match = (searchPage.pets ?? []).find(
      (pet) => sanitizePetId(pet.id) === safeId,
    );
    if (!match || !Number.isInteger(match.catalogPage)) continue;

    const catalogPageUrl = index.pages?.[match.catalogPage!];
    if (!catalogPageUrl) return null;
    const catalogPage = (await fetchJson(
      catalogPageUrl,
      options,
    )) as OpenPetsCatalogPage;
    return (
      (catalogPage.pets ?? [])
        .map(toCommunityPetSummary)
        .find((pet) => pet?.id && sanitizePetId(pet.id) === safeId) ?? null
    );
  }

  return null;
}

async function fetchJson(
  url: string,
  options: { fetchImpl?: typeof fetch },
): Promise<unknown> {
  const text = await fetchLimitedText(url, MAX_JSON_BYTES, options);
  return JSON.parse(text);
}

async function fetchLimitedText(
  url: string,
  maxBytes: number,
  options: { fetchImpl?: typeof fetch },
): Promise<string> {
  const bytes = await fetchLimitedBytes(url, maxBytes, options);
  return new TextDecoder().decode(bytes);
}

async function downloadSpritesheet(
  url: string,
  options: { fetchImpl?: typeof fetch },
): Promise<Uint8Array> {
  return fetchLimitedBytes(url, MAX_SPRITESHEET_BYTES, options);
}

async function fetchLimitedBytes(
  url: string,
  maxBytes: number,
  options: { fetchImpl?: typeof fetch },
): Promise<Uint8Array> {
  let currentUrl = url;
  validateCommunityUrl(currentUrl);
  await assertCommunityHostResolvesToPublicIp(currentUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await (options.fetchImpl ?? fetch)(currentUrl, {
        credentials: 'omit',
        redirect: 'manual',
        signal: controller.signal,
      });

      if (isRedirectStatus(response.status)) {
        const nextUrl = response.headers.get('location');
        if (!nextUrl) throw new Error('Redirect missing Location header');
        currentUrl = new URL(nextUrl, currentUrl).toString();
        validateCommunityUrl(currentUrl);
        await assertCommunityHostResolvesToPublicIp(currentUrl);
        continue;
      }

      validateCommunityUrl(response.url || currentUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) {
          throw new Error(`Response exceeds ${maxBytes} bytes`);
        }
        return buffer;
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`Response exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }

      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    }

    throw new Error('Too many redirects');
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function validateCommunityUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('Community pet URLs must use HTTPS');
  }
  if (!ALLOWED_COMMUNITY_HOSTS.has(parsed.hostname)) {
    throw new Error(`Community pet host is not allowed: ${parsed.hostname}`);
  }
}

// DNS-rebinding defense. The hostname allowlist already restricts to
// openpets.dev, but an attacker who poisons DNS for that host (or a
// compromised resolver) could direct it at private/metadata IPs. Resolve
// before each fetch hop and reject any answer that isn't a public address.
async function assertCommunityHostResolvesToPublicIp(
  url: string,
): Promise<void> {
  const { hostname } = new URL(url);
  const literal = classifyIp(hostname);
  if (literal) {
    if (literal.isPrivateOrSpecial || literal.isMetadata) {
      throw new Error(
        `Community pet host resolves to a non-public address: ${hostname}`,
      );
    }
    return;
  }

  let answers: LookupAddress[];
  try {
    answers = await dns.lookup(hostname, { all: true });
  } catch (error) {
    throw new Error(
      `Community pet host DNS lookup failed for ${hostname}: ${(error as Error).message}`,
    );
  }

  // Defensive: some resolver configurations (split-horizon, NOERROR with an
  // empty answer section) return [] without throwing. Treat that as a hard
  // failure so an empty answer can't silently bypass the IP allowlist below.
  if (answers.length === 0) {
    throw new Error(`Community pet host returned no DNS answers: ${hostname}`);
  }

  for (const answer of answers) {
    const info = classifyIp(answer.address);
    if (!info || info.isPrivateOrSpecial || info.isMetadata) {
      throw new Error(
        `Community pet host resolves to a non-public address (${answer.address}): ${hostname}`,
      );
    }
  }
}

function toCommunityPetSummary(
  pet: OpenPetsCatalogPet,
): CommunityPetSummary | null {
  const id = pickString(pet.id);
  const displayName = pickString(pet.displayName);
  const spritesheetUrl = pickString(pet.spritesheet);
  if (!id || !displayName || !spritesheetUrl) return null;

  try {
    validateCommunityUrl(spritesheetUrl);
  } catch {
    return null;
  }
  const sourceUrl = sourceUrlForSpritesheet(spritesheetUrl);

  return {
    id,
    displayName,
    description: pickString(pet.description) ?? '',
    ...(pickString(pet.thumbnail)
      ? { thumbnailUrl: pickString(pet.thumbnail) }
      : {}),
    spritesheetUrl,
    sourceUrl,
    ...(pickString(pet.category) ? { category: pickString(pet.category) } : {}),
    ...(pet.original === undefined ? {} : { original: Boolean(pet.original) }),
    ...(pet.featured === undefined ? {} : { featured: Boolean(pet.featured) }),
  };
}

function sourceUrlForSpritesheet(url: string): string {
  const parsed = new URL(url);
  const [, root, slug] = parsed.pathname.split('/');
  if (root === 'pets' && slug) {
    return `${parsed.origin}/pets/${slug}`;
  }
  return `${parsed.origin}/gallery`;
}

function validateImageBytes(bytes: Uint8Array, ext: string): void {
  if (bytes.byteLength < 16) {
    throw new Error('Spritesheet is too small');
  }

  const ascii = new TextDecoder('ascii').decode(bytes.subarray(0, 12));
  const isWebp = ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP';
  const isPng = bytes
    .subarray(0, PNG_MAGIC.byteLength)
    .every((byte, index) => byte === PNG_MAGIC[index]);
  const isGif = ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a');

  if (ext === 'webp' && isWebp) return;
  if (ext === 'png' && isPng) return;
  if (ext === 'gif' && isGif) return;
  throw new Error('Spritesheet bytes do not match an accepted image type');
}

async function hasCompletePet(
  sheetPath: string,
  manifestPath: string,
): Promise<boolean> {
  const [sheetStat, manifestStat] = await Promise.all([
    stat(sheetPath).catch(() => null),
    stat(manifestPath).catch(() => null),
  ]);
  return Boolean(sheetStat?.isFile() && manifestStat?.isFile());
}

function extOf(url: string): 'webp' | 'png' | 'gif' {
  const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
  if (ext === 'png' || ext === 'gif') return ext;
  return 'webp';
}

function clampPage(page: number, pageCount: number): number {
  if (!Number.isInteger(page) || page < 0) return 0;
  if (pageCount === 0) return 0;
  return Math.min(page, pageCount - 1);
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function prettyName(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
