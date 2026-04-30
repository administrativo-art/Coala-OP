"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AccountPlanTreeSelect } from '@/components/purchasing/account-plan-tree-select';
import { Label } from '@/components/ui/label';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { usePurchasingFinancialOptions } from '@/hooks/use-purchasing-financial-options';
import { useToast } from '@/hooks/use-toast';

export function PurchasingAccountingSettings() {
  const { toast } = useToast();
  const { purchasingDefaults, updatePurchasingDefaults } = useCompanySettings();
  const { accountPlans, loading } = usePurchasingFinancialOptions();
  const [goodsAccountPlanId, setGoodsAccountPlanId] = useState(purchasingDefaults.goodsAccountPlanId ?? '__none__');
  const [freightAccountPlanId, setFreightAccountPlanId] = useState(purchasingDefaults.freightAccountPlanId ?? '__none__');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updatePurchasingDefaults({
        goodsAccountPlanId: goodsAccountPlanId === '__none__' ? null : goodsAccountPlanId,
        freightAccountPlanId: freightAccountPlanId === '__none__' ? null : freightAccountPlanId,
      });
      toast({ title: 'Configuração de compras atualizada.' });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Erro ao salvar configuração de compras.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Classificação padrão de compras</CardTitle>
        <CardDescription>
          Defina o plano de contas padrão das mercadorias e a rubrica padrão do frete para os pedidos do módulo de compras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Plano de contas padrão da mercadoria</Label>
              <AccountPlanTreeSelect
                value={goodsAccountPlanId}
                onChange={setGoodsAccountPlanId}
                options={accountPlans}
                placeholder="Selecione o plano de contas"
                noneLabel="Sem padrão"
                allowNone
              />
            </div>

            <div className="space-y-2">
              <Label>Plano de contas padrão do frete</Label>
              <AccountPlanTreeSelect
                value={freightAccountPlanId}
                onChange={setFreightAccountPlanId}
                options={accountPlans}
                placeholder="Selecione o plano de contas do frete"
                noneLabel="Sem padrão"
                allowNone
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar configuração
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
