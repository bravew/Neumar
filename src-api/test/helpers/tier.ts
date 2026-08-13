export type EvalTier = 'gate' | 'periodic';

export function tier(t: EvalTier, name: string): string {
  const selected = process.env.EVALS_TIER as EvalTier | undefined;
  if (selected && selected !== t) return `[skip:${t}] ${name}`;
  return `[${t}] ${name}`;
}
