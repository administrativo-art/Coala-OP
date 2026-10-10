/**
 * Instalador do aplicativo Coala One (Android), servido de `public/app/` e oferecido em
 * `/app/coala-one`. `packagePath: null` significa que ainda não há instalador publicado:
 * a página mostra o botão desativado.
 */
export const COALA_ONE_APP_INSTALLER: { packagePath: string | null; version: string; sizeLabel: string | null } = {
  packagePath: "/app/CoalaOne.apk",
  version: "0.1.0",
  sizeLabel: "41 MB",
};
