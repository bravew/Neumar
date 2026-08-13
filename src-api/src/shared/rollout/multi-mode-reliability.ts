function enabledUnlessExplicitlyDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}

export function isOnDemandClarificationEnabled(): boolean {
  return enabledUnlessExplicitlyDisabled(
    process.env.NEUMA_ON_DEMAND_CLARIFICATION_ENABLED,
  );
}

export function isSupplementalSkillSelectionEnabled(): boolean {
  return enabledUnlessExplicitlyDisabled(
    process.env.NEUMA_SUPPLEMENTAL_SKILLS_ENABLED,
  );
}
