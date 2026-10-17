export const ABSENCE_OPERATIONAL_PRODUCTION_PROJECT_ID = 'smart-converter-752gf';

export type GuardEnvironment = {
  firestoreEmulatorHost?: string;
  authEmulatorHost?: string;
  projectId: string;
  nodeEnv?: string;
};

/**
 * ON é aceito em exatamente dois formatos: projeto demo-* em emuladores loopback, ou o projeto de produção
 * sem nenhum emulador configurado. Qualquer mistura falha fechada. Aceitar o ambiente não autoriza escrita:
 * cada transação protegida ainda exige o recibo de prontidão `ready`.
 */
export function absenceGuardEnvironmentAccepted(env: GuardEnvironment) {
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
  const emulatorShape = env.nodeEnv !== 'production'
    && loopback.test(env.firestoreEmulatorHost ?? '') && loopback.test(env.authEmulatorHost ?? '')
    && /^demo-[a-z0-9-]+$/.test(env.projectId);
  const productionShape = !env.firestoreEmulatorHost && !env.authEmulatorHost
    && env.projectId === ABSENCE_OPERATIONAL_PRODUCTION_PROJECT_ID;
  return emulatorShape || productionShape;
}
