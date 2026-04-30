"use client";

import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { collectionGroup, getDocs, query, where } from 'firebase/firestore';

import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/permission-guard';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/firebase';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useEntities } from '@/hooks/use-entities';
import { useAuth } from '@/hooks/use-auth';
import { useQuotations } from '@/hooks/use-quotations';
import { canViewPurchasing } from '@/lib/purchasing-permissions';
import { type QuotationItem } from '@/types';

type CompareRow = QuotationItem & {
  quotationStatus?: string;
  supplierId: string;
  validUntil?: string;
  mode?: string;
};

export default function QuotationComparePage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const { quotations } = useQuotations();
  const { baseProducts } = useBaseProducts();
  const { entities } = useEntities();
  const canView = canViewPurchasing(permissions);
  const [baseItemId, setBaseItemId] = useState('_all');
  const [items, setItems] = useState<CompareRow[]>([]);
  const [loading, setLoading] = useState(true);

  const activeQuotations = useMemo(
    () => quotations.filter((q) => q.status === 'quoted' || q.status === 'partially_converted'),
    [quotations],
  );

  const fetchItems = async () => {
    setLoading(true);
    try {
      const quotationById = new Map(activeQuotations.map((quotation) => [quotation.id, quotation]));
      if (activeQuotations.length === 0) {
        setItems([]);
        return;
      }
      const chunks: string[][] = [];
      for (let index = 0; index < activeQuotations.length; index += 10) {
        chunks.push(activeQuotations.slice(index, index + 10).map((quotation) => quotation.id));
      }
      const snapshots = await Promise.all(
        chunks.map((ids) =>
          getDocs(query(collectionGroup(db, 'items'), where('quotationId', 'in', ids))),
        ),
      );
      const rows = snapshots
        .flatMap((snap) => snap.docs)
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as QuotationItem))
        .filter((item) => item.baseItemId && quotationById.has(item.quotationId))
        .map((item) => {
          const quotation = quotationById.get(item.quotationId)!;
          return {
            ...item,
            supplierId: quotation.supplierId,
            validUntil: quotation.validUntil,
            quotationStatus: quotation.status,
            mode: quotation.mode,
          };
        })
        .sort((a, b) => a.unitPrice - b.unitPrice);
      setItems(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuotations.length]);

  const filtered = useMemo(
    () => items.filter((item) => baseItemId === '_all' || item.baseItemId === baseItemId),
    [items, baseItemId],
  );

  const baseOptions = useMemo(() => {
    const ids = new Set(items.map((item) => item.baseItemId).filter(Boolean));
    return baseProducts.filter((base) => ids.has(base.id));
  }, [baseProducts, items]);

  return (
    <PermissionGuard allowed={canView}>
      <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard/purchasing/quotations')} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Cotações
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Comparativo de Cotações</h1>
          <p className="text-sm text-muted-foreground">
            Menores preços por insumo em cotações finalizadas e ainda ativas.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchItems} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <Select value={baseItemId} onValueChange={setBaseItemId}>
        <SelectTrigger className="w-full sm:w-80">
          <SelectValue placeholder="Filtrar por insumo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">Todos os insumos</SelectItem>
          {baseOptions.map((base) => (
            <SelectItem key={base.id} value={base.id}>
              {base.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-16">
          Nenhum item normalizado em cotação ativa.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Insumo</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Preço unit.</TableHead>
                <TableHead className="text-right">Qtd.</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Modo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const base = baseProducts.find((bp) => bp.id === item.baseItemId);
                const supplier = entities.find((entity) => entity.id === item.supplierId);
                return (
                  <TableRow key={`${item.quotationId}-${item.id}`}>
                    <TableCell className="font-medium">{base?.name ?? item.baseItemId}</TableCell>
                    <TableCell>{supplier?.fantasyName ?? supplier?.name ?? item.supplierId}</TableCell>
                    <TableCell className="text-right font-mono">
                      {item.unitPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/{item.unit}
                    </TableCell>
                    <TableCell className="text-right">{item.quantity} {item.unit}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.validUntil ? format(parseISO(item.validUntil), 'dd/MM/yyyy', { locale: ptBR }) : 'Sem validade'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.mode === 'in_loco' ? 'In loco' : 'Remota'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      </div>
    </PermissionGuard>
  );
}
