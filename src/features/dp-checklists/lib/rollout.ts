import { getFeatureFlags } from "@/lib/feature-flags";
import { WORKSPACE_ID } from "@/lib/workspace";

async function getChecklistRolloutFlags() {
  return getFeatureFlags(WORKSPACE_ID);
}

export async function assertLegacyChecklistReadAllowed() {
  const flags = await getChecklistRolloutFlags();

  if (flags.forms_new_engine_enabled && !flags.forms_read_from_legacy_enabled) {
    throw new Error(
      "O checklist legado está em modo somente migração. Use o novo módulo de formulários."
    );
  }

  return flags;
}

export async function assertLegacyChecklistWriteAllowed() {
  const flags = await getChecklistRolloutFlags();

  if (flags.forms_new_engine_enabled) {
    throw new Error(
      "As escritas do checklist legado foram desativadas. Use o novo módulo de formulários."
    );
  }

  return flags;
}

export async function shouldRedirectLegacyChecklistPages() {
  const flags = await getChecklistRolloutFlags();
  return flags.forms_new_engine_enabled === true;
}
