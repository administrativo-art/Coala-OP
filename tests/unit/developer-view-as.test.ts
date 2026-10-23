import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEVELOPER_VIEW_AS_EMAIL,
  isDeveloperViewAsEmail,
  isDeveloperViewAsReadMethod,
} from "../../src/features/auth/developer-view-as";

test("Visualizar como fica restrito ao login DEV aprovado", () => {
  assert.equal(DEVELOPER_VIEW_AS_EMAIL, "administrativo@coalashakes.com");
  assert.equal(isDeveloperViewAsEmail(" ADMINISTRATIVO@COALASHAKES.COM "), true);
  assert.equal(isDeveloperViewAsEmail("administrativo@cialashakes.com"), false);
  assert.equal(isDeveloperViewAsEmail("outro@cialashakes.com"), false);
});

test("sessão de visualização permite apenas métodos de leitura", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", " get "]) {
    assert.equal(isDeveloperViewAsReadMethod(method), true);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isDeveloperViewAsReadMethod(method), false);
  }
});

test("Sistema e APP expõem seleção, aviso, auditoria e identidade real", () => {
  const authServer = readFileSync("src/lib/auth-server.ts", "utf8");
  const route = readFileSync("src/app/api/auth/view-as/route.ts", "utf8");
  const profile = readFileSync("src/components/user-profile.tsx", "utf8");
  const dashboard = readFileSync("src/app/dashboard/layout.tsx", "utf8");
  const android = readFileSync("apps/coala-one-android/app/src/main/java/com/coalaone/go/MainActivity.kt", "utf8");
  const interceptor = readFileSync("apps/coala-one-android/app/src/main/java/com/coalaone/go/data/AuthenticationInterceptor.kt", "utf8");

  assert.match(authServer, /authenticatedActorIdentity/);
  assert.match(authServer, /isDeveloperViewAsReadMethod\(req\.method\)/);
  assert.match(route, /developer_view_as_started/);
  assert.match(route, /developer_view_as_stopped/);
  assert.match(route, /secureRoute/);
  assert.match(profile, /Visualizar como usuário/);
  assert.match(dashboard, /Visualizando como/);
  assert.match(android, /Visualizar como usuário/);
  assert.match(interceptor, /DEVELOPER_VIEW_AS_HEADER/);
});
