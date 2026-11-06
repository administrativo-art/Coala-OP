import assert from 'node:assert/strict';
import test from 'node:test';

import {
  archiveFileKind,
  DEFAULT_ARCHIVE_VIEW_MODE,
  nextCascadeStack,
  parseArchiveViewMode,
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

test('ícone do arquivo vem do MIME ou da extensão', () => {
  assert.equal(archiveFileKind('Espelho de ponto', 'application/pdf'), 'pdf');
  assert.equal(archiveFileKind('Atestado.JPG'), 'image');
  assert.equal(archiveFileKind('Planilha.xlsx'), 'sheet');
  assert.equal(archiveFileKind('Contrato.docx'), 'text');
  assert.equal(archiveFileKind('Kit publicado de teste'), 'other');
});
