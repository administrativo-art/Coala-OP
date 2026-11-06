import assert from 'node:assert/strict';
import test from 'node:test';

import {
  archiveFileKind,
  DEFAULT_ARCHIVE_VIEW_MODE,
  fichaGroups,
  fichaPlacement,
  fichaTabs,
  nextCascadeStack,
  parseArchiveViewMode,
  resolveFichaTab,
  type CascadeColumn,
} from '../../../src/lib/documents/archive-view-mode';

test('modo salvo inválido ou ausente volta para o painel lateral', () => {
  assert.equal(DEFAULT_ARCHIVE_VIEW_MODE, 'panel');
  assert.equal(parseArchiveViewMode('cascade'), 'cascade');
  assert.equal(parseArchiveViewMode('classic'), 'classic');
  assert.equal(parseArchiveViewMode('grid'), 'panel');
  assert.equal(parseArchiveViewMode(null), 'panel');
  assert.equal(parseArchiveViewMode(42), 'panel');
});

test('cascata empilha a pasta atual ao abrir uma subpasta e corta ao voltar', () => {
  let stack: CascadeColumn<string>[] = [];
  stack = nextCascadeStack(stack, { type: 'open-from-current', scope: 'raiz', entries: ['Ana', 'Bruno'], activeId: 'Ana', nextScope: 'Ana' });
  stack = nextCascadeStack(stack, { type: 'open-from-current', scope: 'Ana', entries: ['Férias', 'Fechamento'], activeId: 'Fechamento', nextScope: 'Ana/Fechamento' });
  assert.deepEqual(stack.map((column) => [column.scope, column.activeId]), [['raiz', 'Ana'], ['Ana', 'Fechamento']]);

  // Voltar pela trilha para "Ana" corta a coluna de Ana (ela passa a ser a coluna atual).
  assert.deepEqual(nextCascadeStack(stack, { type: 'arrived', scope: 'Ana' }).map((column) => column.scope), ['raiz']);
  // Chegar a uma pasta desconhecida não apaga as colunas (a próxima abertura decide).
  assert.equal(nextCascadeStack(stack, { type: 'arrived', scope: 'Ana/Fechamento' }).length, 2);
});

test('cascata troca a pasta marcada ao clicar numa coluna anterior', () => {
  const stack: CascadeColumn<string>[] = [
    { scope: 'raiz', entries: ['Ana', 'Bruno'], activeId: 'Ana' },
    { scope: 'Ana', entries: ['Férias', 'Fechamento'], activeId: 'Fechamento' },
  ];
  const next = nextCascadeStack(stack, { type: 'open-from-column', columnIndex: 0, activeId: 'Bruno', nextScope: 'Bruno' });
  assert.deepEqual(next, [{ scope: 'raiz', entries: ['Ana', 'Bruno'], activeId: 'Bruno' }]);
  assert.deepEqual(nextCascadeStack(stack, { type: 'open-from-column', columnIndex: 9, activeId: 'x', nextScope: 'x' }), []);
});

test('cascata não duplica a coluna quando a mesma pasta é reaberta', () => {
  const stack: CascadeColumn<string>[] = [{ scope: 'raiz', entries: ['Ana'], activeId: 'Ana' }];
  const next = nextCascadeStack(stack, { type: 'open-from-current', scope: 'raiz', entries: ['Ana', 'Bruno'], activeId: 'Bruno', nextScope: 'Bruno' });
  assert.deepEqual(next, [{ scope: 'raiz', entries: ['Ana', 'Bruno'], activeId: 'Bruno' }]);
});

test('ficha separa a aba (primeiro nível) e a subpasta (segundo nível)', () => {
  assert.deepEqual(fichaPlacement(['Fechamento do mês', '2026', 'Agosto']), { tab: 'Fechamento do mês', group: '2026', rest: ['Agosto'] });
  assert.deepEqual(fichaPlacement(['Admissão']), { tab: 'Admissão', group: null, rest: [] });
  assert.deepEqual(fichaPlacement([]), { tab: 'Outros documentos', group: null, rest: [] });
});

test('abas da ficha contam documentos e ficam em ordem alfabética; subpastas mais recentes primeiro', () => {
  const paths = [
    ['Férias', 'Período aquisitivo 2024-2025'],
    ['Admissão'],
    ['Fechamento do mês', '2025', 'Dezembro'],
    ['Fechamento do mês', '2026', 'Agosto'],
    ['Fechamento do mês', '2026', 'Setembro'],
    ['Férias', 'Período aquisitivo 2025-2026'],
  ];
  assert.deepEqual(fichaTabs(paths), [
    { name: 'Admissão', count: 1 },
    { name: 'Fechamento do mês', count: 3 },
    { name: 'Férias', count: 2 },
  ]);
  assert.deepEqual(fichaGroups(paths, 'Fechamento do mês'), [{ name: '2026', count: 2 }, { name: '2025', count: 1 }]);
  assert.deepEqual(fichaGroups(paths, 'Admissão'), []);
});

test('aba pedida que não existe cai na primeira aba', () => {
  const tabs = [{ name: 'Admissão', count: 1 }, { name: 'Férias', count: 2 }];
  assert.equal(resolveFichaTab(tabs, 'Férias'), 'Férias');
  assert.equal(resolveFichaTab(tabs, 'Inexistente'), 'Admissão');
  assert.equal(resolveFichaTab([], 'Férias'), null);
});

test('ícone do arquivo vem do MIME ou da extensão', () => {
  assert.equal(archiveFileKind('Espelho de ponto', 'application/pdf'), 'pdf');
  assert.equal(archiveFileKind('Atestado.JPG'), 'image');
  assert.equal(archiveFileKind('Planilha.xlsx'), 'sheet');
  assert.equal(archiveFileKind('Contrato.docx'), 'text');
  assert.equal(archiveFileKind('Kit publicado de teste'), 'other');
});
