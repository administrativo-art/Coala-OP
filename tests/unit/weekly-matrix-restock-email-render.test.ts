import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderEmail,
  renderPreheader,
  renderSubject,
  renderText,
  type RestockRows,
} from '../../functions/src/weekly-matrix-restock-email-render';

const now = new Date('2026-11-02T11:00:00Z');
const url = 'https://op.coalashakes.com/dashboard/stock/reposition';

const rows: RestockRows = {
  buy: [
    { baseName: 'Leite integral', baseUnit: 'l', stock: 12, minimum: 60, shortage: 48, supplier: 'Distribuidora Norte', productDetail: 'Marca A · 1 l', orderQuantity: 4, orderLabel: 'cx c/ 12' },
    { baseName: 'Copo 500 ml', baseUnit: 'un', stock: 200, minimum: 1000, shortage: 800, supplier: 'Embalagens Pará', orderQuantity: 1, orderLabel: 'cx c/ 1.000' },
  ],
  incoming: [
    { baseName: 'Morango', baseUnit: 'kg', stock: 0, minimum: 20, shortage: 20, incomingSupplier: 'Frutas do Norte', incomingLabel: '10 pacote', expectedDate: '2026-11-04', projectedRemaining: 10 },
    { baseName: 'Canudo', baseUnit: 'un', stock: 0, minimum: 300, shortage: 300, incomingSupplier: 'Embalagens Pará', incomingLabel: '1 caixa', expectedDate: '2026-10-28', projectedRemaining: 0 },
  ],
  undefined: [
    { baseName: 'Calda <b>', baseUnit: 'l', stock: 0, minimum: 6, shortage: 6, issue: 'Escolher fornecedor', issueDetail: 'sem compra anterior registrada' },
  ],
};

test('assunto e prévia da caixa de entrada trazem as contagens da semana', () => {
  assert.equal(renderSubject(rows, now), 'Reposição da Matriz: 2 para comprar · 02/11');
  assert.equal(renderSubject({ buy: [], incoming: [], undefined: [] }, now), 'Reposição da Matriz: nada para comprar · 02/11');
  assert.equal(renderPreheader(rows), '2 a caminho, 1 sem definição. Fornecedores: Distribuidora Norte, Embalagens Pará.');
});

test('compra mostra estoque, mínimo, falta e pedido agrupados por fornecedor', () => {
  const html = renderEmail(rows, now, url);
  assert.match(html, /Distribuidora Norte <span[^>]*>· 1 item<\/span>/);
  assert.match(html, /Leite integral[\s\S]*?Marca A · 1 l[\s\S]*?12 \/ 60 l[\s\S]*?48 l[\s\S]*?4 cx c\/ 12/);
  assert.match(html, new RegExp(`href="${url}"`));
});

test('compra a caminho mostra fornecedor, previsão, atraso e cobertura', () => {
  const html = renderEmail(rows, now, url);
  assert.match(html, /Frutas do Norte · 10 pacote · previsão 04\/11/);
  assert.match(html, /Ainda faltam 10 kg/);
  assert.match(html, /previsão 28\/10, atrasada/);
  assert.match(html, /Cobre a falta/);
});

test('conteúdo vindo do cadastro é escapado e seções vazias têm texto próprio', () => {
  const html = renderEmail(rows, now, url);
  assert.match(html, /Calda &lt;b&gt;/);
  assert.doesNotMatch(html, /Calda <b>/);
  const empty = renderEmail({ buy: [], incoming: [], undefined: [] }, now, url);
  assert.match(empty, /Nenhuma compra sugerida nesta semana\./);
  assert.match(empty, /Nenhum item sem definição\./);
});

test('versão em texto puro repete as mesmas informações', () => {
  const text = renderText(rows, now, url);
  assert.match(text, /Segunda-feira, 2 de novembro, calculado às 08:00/);
  assert.match(text, /- Leite integral \(Marca A · 1 l\): tem 12 \/ mín\. 60 l · comprar 48 l · pedir 4 cx c\/ 12/);
  assert.match(text, /- Canudo: Embalagens Pará · 1 caixa · previsão 28\/10 \(atrasada\) · cobre a falta/);
  assert.match(text, new RegExp(`Abrir no Coala One: ${url}`));
});
