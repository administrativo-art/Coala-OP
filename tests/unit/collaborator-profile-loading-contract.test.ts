import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profilePageSource = readFileSync(
  'src/app/dashboard/dp/collaborators/[userId]/page.tsx',
  'utf8',
);
const profileRouteSource = readFileSync(
  'src/app/api/rh/employee-profile/[employeeId]/route.ts',
  'utf8',
);

test('perfil do colaborador compartilha uma única carga entre todos os painéis', () => {
  const hookCalls = profilePageSource.match(/useEmployeeProfile\s*\(/gu) ?? [];
  assert.equal(hookCalls.length, 1);
  assert.match(profilePageSource, /profileState=\{employeeProfileState\}/u);
});

test('rota carrega os campos legíveis em um único batch', () => {
  assert.match(profileRouteSource, /hrDbAdmin\.getAll\(\.\.\.fieldValueRefs\)/u);
  assert.doesNotMatch(
    profileRouteSource,
    /readableKeys\.map\(\(key\)\s*=>\s*employeeSnap\.ref\.collection\("field_values"\)\.doc\(key\)\.get\(\)/u,
  );
});
