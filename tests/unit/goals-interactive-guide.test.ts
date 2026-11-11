import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calcularBonificacao, CONFIG_PADRAO } from '../../src/components/goals/guide/bonificacao';

describe('guia interativo usa o cálculo oficial de faixas', () => {
  it('reproduz o exemplo completo do guia', () => {
    const result = calcularBonificacao({ faturamento: 36000, diasMes: 30, diasFolguista: 5, pessoasFixas: 2 });
    assert.deepEqual(result.metas.map((meta) => meta.total), [340, 400, 220]);
    assert.equal(result.premioEquipe, 960);
    assert.equal(result.folguista, 160);
    assert.equal(result.porFixa, 400);
    assert.equal(result.adicionalLideranca, 320);
    assert.equal(result.totalPago, 1280);
  });

  it('exibe o fixo configurado mesmo antes de atingir a faixa', () => {
    const result = calcularBonificacao({ faturamento: 28999.99, diasMes: 30, diasFolguista: 5, pessoasFixas: 2 });
    assert.equal(result.metas[0].premiacaoConfig, 100);
    assert.equal(result.metas[0].premiacao, 0);
    assert.equal(result.metas[0].faltam, 0.01);
    assert.equal(result.premioEquipe, 0);
  });

  it('conta dias e aplica os valores configurados sem alterar o método oficial', () => {
    const config = { ...CONFIG_PADRAO, metas: CONFIG_PADRAO.metas.map((meta) => ({ ...meta, premiacao: 80 })) };
    const result = calcularBonificacao({ faturamento: 36000, diasMes: 31, diasFolguista: 5, pessoasFixas: 2 }, config);
    assert.equal(result.premioEquipe, 900);
    assert.equal(result.folguista, 145.16);
    assert.equal(result.adicionalLideranca, 300);
    assert.equal(result.metas[0].premiacaoConfig, 80);
  });
});
