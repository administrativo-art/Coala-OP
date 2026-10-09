import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildLinkedRolePeople,
  flattenTree,
  listRows,
  matchesQuery,
  roleSyncSummary,
} from '../../src/components/dp/roles/roles-model';

type Node = { id: string; name: string; parentId: string | null; order?: number };
const item = (id: string, name: string, parentId: string | null = null, extra: Record<string, unknown> = {}) => ({ id, name, parentId, ...extra }) as unknown as Node;

test('árvore numera por nível, ordena por nome e recolhe os descendentes', () => {
  const items = [item('b', 'Beta'), item('a', 'Alfa'), item('a1', 'Filho 2', 'a'), item('a0', 'Filho 1', 'a')];
  const rows = flattenTree(items);
  assert.deepEqual(rows.map((row) => [row.number, row.item.name, row.depth]), [
    ['1', 'Alfa', 0], ['1.1', 'Filho 1', 1], ['1.2', 'Filho 2', 1], ['2', 'Beta', 0],
  ]);
  assert.equal(rows[0].hasChildren, true);
  const collapsed = flattenTree(items, new Set(['a']));
  assert.deepEqual(collapsed.map((row) => row.item.name), ['Alfa', 'Beta']);
});

test('item cujo pai foi removido vira raiz em vez de sumir, e ciclo não trava', () => {
  const rows = flattenTree([item('x', 'Órfão', 'removido'), item('p', 'Pai', 'q'), item('q', 'Filho', 'p')]);
  assert.ok(rows.some((row) => row.item.name === 'Órfão' && row.depth === 0));
  assert.ok(rows.length <= 3);
});

test('com busca ativa a lista é plana e inclui filho cujo pai não casou', () => {
  const items = [item('a', 'Operador'), item('a1', 'Caixa', 'a')];
  const rows = listRows(items, (entry) => matchesQuery('caixa', entry.name), 'caixa', new Set());
  assert.deepEqual(rows.map((row) => [row.item.name, row.depth, row.number]), [['Caixa', 0, '']]);
  assert.equal(listRows(items, () => true, '  ', new Set()).length, 2);
});

test('pessoas vinculadas ordenam pela hierarquia da função e usam o nome legado como reserva', () => {
  const functions = [item('f1', 'Líder', null, { order: 0 }), item('f2', 'Caixa', 'f1', { order: 0 })] as never[];
  const users = [
    { id: 'u1', username: 'Zeca', jobRoleId: 'r', jobFunctionIds: ['f2'], unitIds: ['un1'] },
    { id: 'u2', username: 'Ana', jobRoleId: 'r', jobFunctionIds: ['f1'], unitIds: [] },
    { id: 'u3', username: 'Bia', jobRoleId: 'r', jobFunctionIds: [], jobFunctionNames: ['Sem cadastro'] },
    { id: 'u4', username: 'Fora', jobRoleId: 'outro' },
  ] as never[];
  const people = buildLinkedRolePeople({ id: 'r' } as never, users, functions, [{ id: 'un1', name: 'Loja' }]);
  assert.deepEqual(people.map((person) => person.name), ['Ana', 'Zeca', 'Bia']);
  assert.deepEqual(people[1].unitNames, ['Loja']);
  assert.equal(people[2].functions[0].name, 'Sem cadastro');
});

test('resumo de sincronização conta vinculados e perfis fora do padrão do cargo', () => {
  const roles = [{ id: 'r1', defaultProfileId: 'p1' }, { id: 'r2' }] as never[];
  const users = [
    { id: 'a', jobRoleId: 'r1', profileId: 'p1' },
    { id: 'b', jobRoleId: 'r1', profileId: 'p9' },
    { id: 'c', jobRoleId: 'r2', profileId: 'p9' },
    { id: 'd' },
  ] as never[];
  const summary = roleSyncSummary(roles, users);
  assert.deepEqual(summary.get('r1'), { assigned: 2, mismatched: 1 });
  assert.deepEqual(summary.get('r2'), { assigned: 1, mismatched: 0 });
});

const files = [
  'src/components/dp/dp-settings-shifts.tsx',
  'src/components/dp/dp-settings-calendars.tsx',
  'src/components/dp/dp-login-access-diagnostic.tsx',
  'src/components/dp/dp-login-access-audit.tsx',
  'src/components/dp/dp-login-access-settings.tsx',
  'src/components/access-profiles-settings.tsx',
  'src/components/dp/dp-settings-roles.tsx',
  'src/components/dp/roles/catalog-panels.tsx',
];

test('Jornada e Equipe usam o guia: sem hex, sem cor fora dos tokens e sem diálogo nativo', () => {
  for (const path of files) {
    const code = readFileSync(path, 'utf8');
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${path}: hex solto`);
    assert.doesNotMatch(code, /\b(?:bg|text|border)-(?:slate|pink|rose|emerald|violet|amber|sky|blue|indigo)-\d{2,3}\b/, `${path}: cor Tailwind fora dos tokens`);
    assert.doesNotMatch(code, /\balert\(|\bconfirm\(|\bprompt\(|AlertDialog/, `${path}: diálogo nativo`);
  }
});

test('exclusão e sincronização são confirmadas inline, e falhas de gravação aparecem no painel', () => {
  assert.match(readFileSync('src/components/dp/dp-settings-shifts.tsx', 'utf8'), /InlineConfirm/);
  assert.match(readFileSync('src/components/dp/dp-settings-calendars.tsx', 'utf8'), /InlineConfirm/);
  const panels = readFileSync('src/components/dp/roles/catalog-panels.tsx', 'utf8');
  assert.match(panels, /InlineConfirm/);
  assert.match(panels, /Não foi possível salvar o cargo/);
  assert.match(panels, /role="alert"/);
});

test('Acesso por escala mostra uma visão por vez e a página usa o wrapper', () => {
  assert.match(readFileSync('src/components/dp/dp-login-access-settings.tsx', 'utf8'), /Segmented/);
  const page = readFileSync('src/app/dashboard/settings/page.tsx', 'utf8');
  assert.match(page, /<DPLoginAccessSettings \/>/);
  assert.doesNotMatch(page, /<DPLoginAccessDiagnostic|<DPLoginAccessAudit/);
});
