export function requiredOnboardingIntegrationsResolved(value: unknown) {
  if (!Array.isArray(value)) return false;

  const statuses = new Map<string, unknown>();
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const alert = entry as Record<string, unknown>;
    if (typeof alert.id === 'string') statuses.set(alert.id, alert.status);
  });

  return statuses.get('bizneo_id') === 'resolved' && statuses.get('pdv_id') === 'resolved';
}

export type OnboardingIntegrationAlertValue = {
  id: string;
  label: string;
  status: 'pending' | 'resolved';
  message: string;
  checkedAt: string;
  externalId?: string;
  source: string;
};

export function pdvPendingPasswordMessage(filialName: unknown) {
  const filial = typeof filialName === 'string' && filialName.trim()
    ? filialName.trim()
    : null;
  return filial
    ? `Aguardando a colaboradora definir a senha do PDV. O cadastro será criado na filial ${filial}.`
    : 'Aguardando a colaboradora definir a senha do PDV para concluir o cadastro.';
}

export function pendingPdvOnboardingAlert(params: {
  pdvAccessStatus: unknown;
  filialName: unknown;
  checkedAt: string;
}): OnboardingIntegrationAlertValue {
  const awaitingPassword = params.pdvAccessStatus === 'pending_password';
  return {
    id: 'pdv_id',
    label: 'PDV Legal',
    status: 'pending',
    message: awaitingPassword
      ? pdvPendingPasswordMessage(params.filialName)
      : 'Colaborador não localizado no PDV Legal para a filial desta unidade.',
    checkedAt: params.checkedAt,
    source: awaitingPassword ? 'onboarding_first_access' : 'pdv_api',
  };
}

export function resolvedPdvOnboardingAlert(params: {
  externalId: string;
  filialName: unknown;
  checkedAt: string;
  source: 'pdv_api' | 'onboarding_first_access';
  action: 'located' | 'created';
}): OnboardingIntegrationAlertValue {
  const filial = typeof params.filialName === 'string' && params.filialName.trim()
    ? params.filialName.trim()
    : null;
  const action = params.action === 'created' ? 'criado' : 'localizado';
  return {
    id: 'pdv_id',
    label: 'PDV Legal',
    status: 'resolved',
    message: filial
      ? `Cadastro ${action} na filial ${filial} (ID ${params.externalId}).`
      : `Cadastro ${action} no PDV Legal (ID ${params.externalId}).`,
    checkedAt: params.checkedAt,
    externalId: params.externalId,
    source: params.source,
  };
}

export function replaceOnboardingIntegrationAlert(
  value: unknown,
  alert: OnboardingIntegrationAlertValue,
) {
  const current = Array.isArray(value)
    ? value.filter((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
        return (entry as Record<string, unknown>).id !== alert.id;
      })
    : [];
  return [alert, ...current];
}
