import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveConfiguredMonthlySalary,
  salaryBaseFunctionId,
} from '../../../src/features/hr/compensation/job-function-salary';
import { formatBrlCurrency, parseBrlCurrency } from '../../../src/features/hr/compensation/brl-currency';

test('formata e interpreta remuneração em real brasileiro', () => {
  assert.equal(formatBrlCurrency(1787.3).replace(/\u00a0/g, ' '), 'R$ 1.787,30');
  assert.equal(parseBrlCurrency('R$ 1.787,30'), 1787.3);
  assert.equal(parseBrlCurrency('1787,30'), 1787.3);
});

test('usa a faixa fixa da função quando não há regra percentual', () => {
  assert.equal(resolveConfiguredMonthlySalary({
    jobFunction: { salaryRange: { min: 1787.3, max: 1787.3, currency: 'BRL' } },
  }), 1787.3);
});

test('calcula a liderança como base mais gratificação percentual', () => {
  const leader = {
    salaryCalculation: {
      type: 'base_plus_percentage',
      baseFunctionId: 'attendant',
      additionalPercentage: 37,
    },
  };
  assert.equal(salaryBaseFunctionId(leader), 'attendant');
  assert.equal(resolveConfiguredMonthlySalary({
    jobFunction: leader,
    baseFunction: { salaryRange: { min: 1787.3, max: 1787.3, currency: 'BRL' } },
  }), 2448.6);
});

test('não transforma regra percentual incompleta em salário fixo', () => {
  assert.equal(resolveConfiguredMonthlySalary({
    jobFunction: {
      salaryRange: { min: 2448.6, max: 2448.6, currency: 'BRL' },
      salaryCalculation: {
        type: 'base_plus_percentage',
        baseFunctionId: 'attendant',
        additionalPercentage: 37,
      },
    },
  }), null);
});
