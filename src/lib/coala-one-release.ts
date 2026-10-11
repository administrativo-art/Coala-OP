/**
 * Versão do aplicativo Coala One publicada no sistema. O aplicativo consulta `GET /api/app/version`
 * e oferece o botão "Atualizar"; abaixo de `minVersionCode` ele só mostra a tela de atualização.
 *
 * `versionCode` e `versionName` precisam bater com `apps/coala-notas/app.json` (um teste confere) e o
 * APK em `public/app/CoalaMobile.apk` precisa ser o desta versão. O Android só aceita instalar por cima
 * um APK de `versionCode` maior. Suba `minVersionCode` só para travar versões com problema.
 */
export const COALA_ONE_RELEASE = {
  versionCode: 2,
  versionName: '0.1.1',
  minVersionCode: 1,
} as const;
