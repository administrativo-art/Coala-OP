"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

import { ListSkeleton } from "@/components/cadastros/cadastros-ui";
import { useAuth } from "@/hooks/use-auth";

/**
 * A tela de atalhos de Gestão de estoque foi removida: o acesso é pela barra lateral.
 * Esta rota continua existindo para links antigos e botões "Voltar" e leva ao primeiro destino permitido.
 */
export default function StockEntryRedirect() {
  const router = useRouter();
  const { permissions, loading } = useAuth();

  const destination = useMemo(() => {
    if (permissions.stock.inventoryControl.view) return "/dashboard/inventory-control";
    if (permissions.stock.stockCount.view) return "/dashboard/stock/count";
    if (permissions.reposition.view || permissions.stock.analysis.restock) return "/dashboard/stock/analysis";
    if (permissions.stock.analysis.view) return "/dashboard/stock/analysis/consumption";
    if (permissions.stock.returns.view) return "/dashboard/stock/returns";
    if (permissions.stock.conversions.view) return "/dashboard/conversions";
    if (permissions.stock.purchasing.view || permissions.purchasing?.view) return "/dashboard/purchasing";
    return null;
  }, [permissions]);

  useEffect(() => {
    if (!loading && destination) router.replace(destination);
  }, [loading, destination, router]);

  if (!loading && !destination) {
    return <p role="alert" className="rounded-ds-card border border-ds-border p-6 text-sm text-ds-ink-muted">Sem permissão para acessar a gestão de estoque.</p>;
  }
  return (
    <div className="rounded-ds-card-lg border border-ds-border bg-ds-warm" role="status" aria-label="Abrindo a gestão de estoque">
      <ListSkeleton rows={3} />
    </div>
  );
}
