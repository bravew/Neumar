import { API_BASE_URL } from '@/config';

export interface AssetMaterializationBudgetDetail {
  code: 'ASSET_MATERIALIZE_BUDGET_EXCEEDED';
  budget: 'session' | 'project';
  usedBytes: number;
  limitBytes: number;
  requestedBytes: number;
  requiredBytes: number;
  sessionId?: string;
  scope: string;
  scopeId: string;
}

export class AssetMaterializationBudgetError extends Error {
  constructor(
    message: string,
    readonly detail: AssetMaterializationBudgetDetail,
  ) {
    super(message);
    this.name = 'AssetMaterializationBudgetError';
  }
}

export interface AssetMaterializationBudgetLabels {
  budgetIncreasePrompt: string;
  budgetProjectLabel: string;
  budgetSessionLabel: string;
}

const DEFAULT_SESSION_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_PROJECT_BUDGET_BYTES = 20 * 1024 * 1024 * 1024;

export function materializationBudgetErrorFromApiData(
  data: Record<string, unknown>,
  fallbackMessage: string,
): AssetMaterializationBudgetError | null {
  const detail = data.detail;
  if (!isAssetMaterializationBudgetDetail(detail)) return null;
  return new AssetMaterializationBudgetError(fallbackMessage, detail);
}

export function isAssetMaterializationBudgetError(
  error: unknown,
): error is AssetMaterializationBudgetError {
  return error instanceof AssetMaterializationBudgetError;
}

export function assetMaterializationBudgetLabel(
  error: AssetMaterializationBudgetError,
  labels: AssetMaterializationBudgetLabels,
): string {
  const budget =
    error.detail.budget === 'session'
      ? labels.budgetSessionLabel
      : labels.budgetProjectLabel;
  return labels.budgetIncreasePrompt
    .replace('{budget}', budget)
    .replace('{used}', formatAssetBudgetBytes(error.detail.usedBytes))
    .replace('{limit}', formatAssetBudgetBytes(error.detail.limitBytes))
    .replace('{requested}', formatAssetBudgetBytes(error.detail.requestedBytes))
    .replace('{required}', formatAssetBudgetBytes(error.detail.requiredBytes));
}

export async function applyAssetMaterializationBudgetIncrease(
  detail: AssetMaterializationBudgetDetail,
) {
  const key =
    detail.budget === 'session'
      ? 'assets.materialize_session_budget_bytes'
      : 'assets.materialize_project_budget_bytes';
  const fallback =
    detail.budget === 'session'
      ? DEFAULT_SESSION_BUDGET_BYTES
      : DEFAULT_PROJECT_BUDGET_BYTES;
  const current = await readSettingNumber(key, fallback);
  await saveSetting(key, String(Math.max(current, detail.requiredBytes)));
}

async function readSettingNumber(key: string, fallback: number) {
  const response = await fetch(
    `${API_BASE_URL}/db/settings/${encodeURIComponent(key)}`,
  );
  if (!response.ok) return fallback;
  const data = (await response.json()) as { value?: string };
  const parsed = Number(data.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function saveSetting(key: string, value: string) {
  const response = await fetch(
    `${API_BASE_URL}/db/settings/${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function formatAssetBudgetBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${trimNumber(bytes / (1024 * 1024 * 1024))} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${trimNumber(bytes / (1024 * 1024))} MB`;
  }
  return `${Math.max(0, Math.round(bytes))} B`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isAssetMaterializationBudgetDetail(
  value: unknown,
): value is AssetMaterializationBudgetDetail {
  if (!isRecord(value)) return false;
  return (
    value.code === 'ASSET_MATERIALIZE_BUDGET_EXCEEDED' &&
    (value.budget === 'session' || value.budget === 'project') &&
    typeof value.usedBytes === 'number' &&
    typeof value.limitBytes === 'number' &&
    typeof value.requestedBytes === 'number' &&
    typeof value.requiredBytes === 'number' &&
    typeof value.scope === 'string' &&
    typeof value.scopeId === 'string' &&
    (value.sessionId === undefined || typeof value.sessionId === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
