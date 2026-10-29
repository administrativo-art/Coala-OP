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
const profileHookSource = readFileSync(
  'src/features/rh/hooks/useEmployeeProfile.ts',
  'utf8',
);
const sidePanelSource = readFileSync(
  'src/components/patterns/side-panel.tsx',
  'utf8',
);
const globalStylesSource = readFileSync('src/app/globals.css', 'utf8');

test('perfil do colaborador compartilha uma única carga entre todos os painéis', () => {
  const hookCalls = profilePageSource.match(/useEmployeeProfile\s*\(/gu) ?? [];
  assert.equal(hookCalls.length, 1);
  assert.doesNotMatch(profilePageSource, /useFieldMap\s*\(/u);
  assert.match(profilePageSource, /profileState=\{employeeProfileState\}/u);
});

test('menu do perfil não oferece edição da configuração global de campos', () => {
  assert.doesNotMatch(profilePageSource, />\s*Editar campos\s*</u);
});

test('rota carrega os campos legíveis em um único batch', () => {
  assert.match(profileRouteSource, /hrDbAdmin\.getAll\(\.\.\.fieldValueRefs\)/u);
  assert.doesNotMatch(
    profileRouteSource,
    /readableKeys\.map\(\(key\)\s*=>\s*employeeSnap\.ref\.collection\("field_values"\)\.doc\(key\)\.get\(\)/u,
  );
});

test('fontes independentes do perfil são carregadas em paralelo', () => {
  assert.match(profileRouteSource, /const \[fieldMap, personLink\] = await Promise\.all/u);
  assert.match(
    profileRouteSource,
    /const \[onboardingByEmployee, onboardingByEmail, fieldValueSnaps, changeRequestSnapshot\] = await Promise\.all/u,
  );
});

test('revisitas preservam o último perfil autorizado durante a revalidação', () => {
  assert.match(profileHookSource, /const employeeProfileCache = new Map/u);
  assert.match(profileHookSource, /Exibe o último perfil autorizado imediatamente e revalida em segundo plano/u);
  assert.match(profileHookSource, /EMPLOYEE_PROFILE_CACHE_LIMIT = 25/u);
});

test('ações frequentes ficam visíveis e ações sensíveis permanecem no menu', () => {
  assert.match(profilePageSource, />\s*Editar dados\s*<\/button>/u);
  assert.match(profilePageSource, /<HeaderIconLink[^>]*label="Documentos"/u);
  assert.doesNotMatch(profilePageSource, /Perfil completo|EmployeeProfileHeaderSummary/u);
  assert.match(profilePageSource, /Consentimento de imagem e voz/u);
  assert.match(profilePageSource, /terminationCopyForRelationship/u);
});

test('índice do perfil agrupa seções, informa estado e acompanha a rolagem', () => {
  assert.match(profilePageSource, /PROFILE_NAVIGATION_GROUP_ORDER/u);
  assert.match(profilePageSource, /aria-label="Seções do perfil"/u);
  assert.match(profilePageSource, /data-profile-navigation-section/u);
  assert.match(profilePageSource, /new IntersectionObserver/u);
  assert.match(profilePageSource, /campos preenchidos/u);
  assert.match(profilePageSource, /<EmployeeProfileFields[\s\S]*renderSystemBlock\("system\.transport_voucher"\)[\s\S]*<\/EmployeeProfileFields>/u);
  assert.doesNotMatch(profilePageSource, /<span className="truncate">\{sectionDisplayLabel\(section\)\}<\/span>/u);
});

test('drawer lateral ocupa a altura dinâmica inteira e não recebe o limite dos dialogs', () => {
  assert.match(sidePanelSource, /h-dvh max-h-dvh/u);
  assert.match(globalStylesSource, /\[role='dialog'\]:not\(\[data-ui='side-panel'\]\)/u);
  assert.match(globalStylesSource, /\[data-ui='side-panel'\][\s\S]*height: 100dvh;[\s\S]*max-height: 100dvh !important;/u);
});
