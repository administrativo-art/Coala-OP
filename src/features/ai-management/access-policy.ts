export function canViewAiCosts(actor: {
  isDefaultAdmin: boolean;
  permissions?: { settings?: { view?: boolean; viewAiCosts?: boolean } };
}): boolean {
  return actor.isDefaultAdmin || (
    actor.permissions?.settings?.view === true && actor.permissions.settings.viewAiCosts === true
  );
}
