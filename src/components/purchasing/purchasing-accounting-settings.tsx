"use client";

import { useEffect, useState } from 'react';

import { Field } from '@/components/patterns/field';
import { AccountPlanTreeSelect } from '@/components/purchasing/account-plan-tree-select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { usePurchasingFinancialOptions } from '@/hooks/use-purchasing-financial-options';

export function PurchasingAccountingSettings() {
  const { purchasingDefaults, updatePurchasingDefaults } = useCompanySettings();
  const { accountPlans, loading } = usePurchasingFinancialOptions();
  const [goodsAccountPlanId, setGoodsAccountPlanId] = useState(purchasingDefaults.goodsAccountPlanId ?? '__none__');
  const [freightAccountPlanId, setFreightAccountPlanId] = useState(purchasingDefaults.freightAccountPlanId ?? '__none__');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Os padrões podem chegar depois da primeira renderização; sem isso "Salvar" gravaria "Sem padrão" por cima deles.
  useEffect(() => {
    setGoodsAccountPlanId(purchasingDefaults.goodsAccountPlanId ?? '__none__');
    setFreightAccountPlanId(purchasingDefaults.freightAccountPlanId ?? '__none__');
  }, [purchasingDefaults.goodsAccountPlanId, purchasingDefaults.freightAccountPlanId]);

  const dirty =
    goodsAccountPlanId !== (purchasingDefaults.goodsAccountPlanId ?? '__none__') ||
    freightAccountPlanId !== (purchasingDefaults.freightAccountPlanId ?? '__none__');

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updatePurchasingDefaults({
        goodsAccountPlanId: goodsAccountPlanId === '__none__' ? null : goodsAccountPlanId,
        freightAccountPlanId: freightAccountPlanId === '__none__' ? null : freightAccountPlanId,
      });
      setSaved(true);
    } catch {
      setSaveError('Não foi possível salvar a configuração de compras. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-3xl space-y-6 rounded-ds-card-lg border border-ds-border bg-ds-warm p-6">
      <header>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">Módulo de compras</p>
        <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em]">Classificação padrão de compras</h2>
        <p className="mt-1 text-[13px] text-ds-ink-muted">
          Defina o plano de contas padrão das mercadorias e a rubrica padrão do frete para os pedidos do módulo de compras.
        </p>
      </header>

      {loading ? (
        <div className="space-y-4" role="status" aria-label="Carregando planos de contas">
          <Skeleton className="h-16 w-full rounded-ds-btn" />
          <Skeleton className="h-16 w-full rounded-ds-btn" />
        </div>
      ) : (
        <>
          <Field label="Plano de contas padrão da mercadoria" requirement="opcional" hint="Usado quando o pedido não define outra classificação para a mercadoria.">
            <AccountPlanTreeSelect
              value={goodsAccountPlanId}
              onChange={(value) => { setGoodsAccountPlanId(value); setSaved(false); }}
              options={accountPlans}
              placeholder="Selecione o plano de contas"
              noneLabel="Sem padrão"
              allowNone
            />
          </Field>
          <Field label="Plano de contas padrão do frete" requirement="opcional" hint="Rubrica aplicada ao frete dos pedidos.">
            <AccountPlanTreeSelect
              value={freightAccountPlanId}
              onChange={(value) => { setFreightAccountPlanId(value); setSaved(false); }}
              options={accountPlans}
              placeholder="Selecione o plano de contas do frete"
              noneLabel="Sem padrão"
              allowNone
            />
          </Field>

          {saveError ? (
            <p role="alert" className="rounded-ds-btn border border-ds-confirm-border bg-ds-confirm-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-confirm-ink">{saveError}</p>
          ) : null}
          {saved ? (
            <p role="status" className="rounded-ds-btn border border-ds-ok/25 bg-ds-ok-bg px-3.5 py-3 text-[12.5px] font-semibold text-ds-ok">Configuração de compras atualizada.</p>
          ) : null}

          <div className="flex justify-end border-t border-ds-divider pt-4">
            <Button type="button" variant="primary-page" size="md" loading={saving} loadingLabel="Salvando…" disabled={!dirty} onClick={() => void handleSave()}>
              Salvar configuração
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
