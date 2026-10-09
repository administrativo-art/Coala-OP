import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildResponsibilityPayload,
  coverageSummaryFor,
  describeResponsibility,
  matchUnitByName,
  mergeOperationalUnits,
  patchResponsibility,
  emptyResponsibilityForm,
  buildGroupedUnitEntries,
  buildGroupedGroupEntries,
} from '../../src/components/dp/units/units-model';

const read = (path: string) => readFileSync(path, 'utf8');
const screen = read('src/components/dp/dp-settings-units.tsx');
const detail = read('src/components/dp/units/unit-detail-panel.tsx');
const structure = read('src/components/dp/units/structure-panels.tsx');
const wizard = read('src/components/dp/units/unit-wizard-modal.tsx');

const unit = (over: Record<string, unknown>) => ({ id: 'u1', name: 'Quiosque Centro', ...over }) as never;
const kiosk = (over: Record<string, unknown>) => ({ id: 'k1', name: 'Quiosque Centro', ...over }) as never;

test('quiosque sem cadastro aparece como só operacional e o sem nome não quebra a lista', () => {
  const merged = mergeOperationalUnits([unit({})], [kiosk({}), kiosk({ id: 'k2', name: 'Loja Norte', pdvFilialId: '77' }), kiosk({ id: 'k3', name: undefined })]);
  assert.equal(merged.filter((item) => item.dpUnit).length, 1);
  const operationalOnly = merged.filter((item) => !item.dpUnit);
  assert.equal(operationalOnly.length, 2);
  assert.ok(operationalOnly.some((item) => item.pdvFilialId === '77'));
  assert.ok(operationalOnly.some((item) => item.name === 'k3'));
});

test('unidade sincronizada usa o quiosque pelo externalId e herda PDV e Bizneo', () => {
  const merged = mergeOperationalUnits(
    [unit({ externalSource: 'kiosk', externalId: 'k9' })],
    [kiosk({ id: 'k9', name: 'Outro nome', pdvFilialId: '12', bizneoId: '345' })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pdvFilialId, '12');
  assert.equal(merged[0].bizneoTaxonId, 345);
});

test('casamento por nome ignora a palavra quiosque e não casa nome vazio', () => {
  assert.equal(matchUnitByName('Quiosque Centro', [unit({})])?.id, 'u1');
  assert.equal(matchUnitByName(undefined, [unit({})]), undefined);
});

test('cobertura sem horário configurado pede atenção; sob demanda e desativada não', () => {
  assert.equal(coverageSummaryFor(unit({ coverageMode: 'fixed_hours' })).needsConfiguration, true);
  assert.equal(coverageSummaryFor(unit({ coverageMode: 'on_demand' })).needsConfiguration, false);
  assert.equal(coverageSummaryFor(unit({ coverageMode: 'disabled' })).needsConfiguration, false);
});

test('responsabilidade incompleta limpa os cinco campos e trocar o tipo limpa os níveis seguintes', () => {
  const directory = { roles: [], functions: [], users: [] };
  const cleared = buildResponsibilityPayload({ ...emptyResponsibilityForm(), responsibleSourceType: 'job_role' }, directory);
  assert.deepEqual(Object.values(cleared), [undefined, undefined, undefined, undefined, undefined]);
  const changed = patchResponsibility(
    { responsibleSourceType: 'job_role', responsibleSourceId: 'r1', responsibleUserId: 'u1' },
    { responsibleSourceType: 'job_function' },
  );
  assert.equal(changed.responsibleSourceId, '');
  assert.equal(changed.responsibleUserId, '');
});

test('responsável removido pede novo responsável', () => {
  const info = describeResponsibility(
    { responsibleSourceType: 'job_role', responsibleSourceName: 'Gerente', responsibleUserId: 'saiu' } as never,
    [],
  );
  assert.equal(info?.needsReplacement, true);
  assert.equal(info?.source, 'Cargo: Gerente');
  assert.equal(describeResponsibility({} as never, []), null);
});

test('a tela compõe o guia: lista com ListRow, painel lateral, modal em etapas e confirmação inline', () => {
  assert.match(screen, /ListRow/);
  assert.match(detail, /SidePanel/);
  assert.match(structure, /SidePanel/);
  assert.match(wizard, /WizardModal/);
  assert.match(detail + structure, /InlineConfirm/);
  for (const source of [screen, detail, structure, wizard]) {
    assert.doesNotMatch(source, /AlertDialog|window\.confirm|\bconfirm\(|\balert\(/);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/);
  }
});

test('endereço e CEP são botões visíveis, sem depender de passar o mouse ou botão direito', () => {
  assert.match(detail, /Copiar endereço/);
  assert.match(detail, /Copiar CEP/);
  assert.doesNotMatch(detail, /Popover|onMouseEnter|onContextMenu/);
});

test('contrato com o e2e de estoque: grupo que abastece, função no estoque e botões de salvar', () => {
  assert.match(structure, /data-testid="group-supplied-groups"/);
  assert.match(structure, /aria-label=\{`Abastece \$\{candidate\.name\}`\}/);
  assert.match(structure, /Salvar grupo/);
  assert.match(wizard, /data-testid="unit-stock-role"/);
  assert.match(wizard, /aria-label="Função no estoque"/);
  assert.match(wizard, /Unidade de abastecimento/);
});

test('permissão de gestão esconde criar, editar e excluir', () => {
  assert.match(screen, /primary=\{canManageUnits \? primary : undefined\}/);
  assert.match(detail, /canManage \? \(/);
  assert.match(structure, /canManage \? \(/);
});

test('PDV Legal e Bizneo são capturados automaticamente e ficam congelados no modal', () => {
  const integrationsStep = wizard.slice(wizard.indexOf('{stepIndex === 3'));
  assert.equal((integrationsStep.match(/readOnly/g) ?? []).length, 2);
  assert.doesNotMatch(integrationsStep, /<Select|onChange=/);
  assert.doesNotMatch(wizard, /pdvlegal\/filiais|getIdToken/);
});

const org = { id: 'o1', name: 'Regional 1' } as never;
const groupCd = { id: 'g1', name: 'CD - Grupo Elo', organizationId: 'o1' } as never;
const groupElo = { id: 'g2', name: 'Grupo Elo', organizationId: 'o1' } as never;
const mk = (id: string, groupId?: string) => ({ key: `unit-${id}`, name: id, groupId, dpUnit: { id } }) as never;
const structureOf = (unit: { groupId?: string }) => {
  const group = [groupCd, groupElo].find((item: { id: string }) => item.id === unit.groupId) as never;
  return { group, organization: group ? org : undefined };
};

test('agrupar por organização aninha grupos e põe "Sem ..." por último', () => {
  const units = [mk('a', 'g1'), mk('b', 'g2'), mk('c', 'g2'), mk('d')];
  const entries = buildGroupedUnitEntries(units, 'organization', [org], [groupCd, groupElo], structureOf as never);
  const bands = entries.filter((entry) => entry.type === 'band') as Array<{ title: string; level: number; meta: string }>;
  assert.deepEqual(bands.map((band) => [band.level, band.title]), [
    [0, 'Regional 1'], [1, 'CD - Grupo Elo'], [1, 'Grupo Elo'], [0, 'Sem organização'], [1, 'Sem grupo'],
  ]);
  assert.equal(bands[0].meta, '2 grupos · 3 unidades');
  assert.equal(entries.filter((entry) => entry.type === 'unit').length, 4);
});

test('agrupar por grupo usa uma faixa por grupo com a organização como subtítulo e omite faixas vazias', () => {
  const entries = buildGroupedUnitEntries([mk('b', 'g2')], 'group', [org], [groupCd, groupElo], structureOf as never);
  const bands = entries.filter((entry) => entry.type === 'band') as Array<{ title: string; subtitle?: string }>;
  assert.deepEqual(bands.map((band) => [band.title, band.subtitle]), [['Grupo Elo', 'Regional 1']]);
});

test('sem agrupamento a lista não ganha faixas; grupos por organização separam os sem organização', () => {
  assert.equal(buildGroupedUnitEntries([mk('a', 'g1')], 'none', [org], [groupCd], structureOf as never).some((entry) => entry.type === 'band'), false);
  const orphan = { id: 'g9', name: 'Solto' } as never;
  const entries = buildGroupedGroupEntries([groupCd, orphan], 'organization', [org]);
  assert.deepEqual(entries.filter((entry) => entry.type === 'band').map((band) => (band as { title: string }).title), ['Regional 1', 'Sem organização']);
});

test('faixas recolhem e a tela oferece o seletor Agrupar por', () => {
  assert.match(screen, /aria-label="Agrupar por"/);
  assert.match(screen, /aria-expanded=\{!isCollapsed\}/);
  assert.match(screen, /isHidden\(entry\.ancestors\)/);
});
