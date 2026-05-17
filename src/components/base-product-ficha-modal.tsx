"use client";

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { type BaseProduct, type Product } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Package, FlaskConical, Edit, ZoomIn, AlertCircle, ImageIcon, Info,
  DollarSign, Clock,
} from 'lucide-react';
import { useProducts } from '@/hooks/use-products';
import { useClassifications } from '@/hooks/use-classifications';
import { useKiosks } from '@/hooks/use-kiosks';

const formatCurrency = (value?: number) => {
  if (!value || isNaN(value)) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 3 });
};

interface BaseProductFichaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseProduct: BaseProduct | null;
  onEdit: (baseProduct: BaseProduct) => void;
}

function NutritionalCard({ product }: { product: Product }) {
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const hasData = product.nutritionalData || product.compositionText || product.detectedAllergens?.length;
  const hasPhotos = product.nutritionalTableImageUrl || product.compositionImageUrl;

  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Product header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{product.baseName}</p>
          <p className="text-xs text-gray-500">
            {product.brand && <span>{product.brand} · </span>}
            {product.packageSize} {product.unit} · {product.packageType || 'Embalagem'}
          </p>
        </div>
        {!hasData && (
          <Badge variant="secondary" className="text-[10px] flex-shrink-0">Sem dados</Badge>
        )}
      </div>

      {/* Photos row */}
      {hasPhotos && (
        <div className="flex gap-3 px-4 py-3 border-b border-gray-50">
          {product.nutritionalTableImageUrl && (
            <button
              onClick={() => setZoomedImage(product.nutritionalTableImageUrl!)}
              className="group relative rounded-lg overflow-hidden border border-gray-200 flex-shrink-0 focus:outline-none"
              style={{ width: 72, height: 72 }}
            >
              <Image src={product.nutritionalTableImageUrl} alt="Tabela nutricional" fill className="object-cover" sizes="72px" />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="h-4 w-4 text-white" />
              </div>
              <span className="absolute bottom-0 inset-x-0 text-[8px] text-center text-white font-bold bg-black/60 py-0.5">Nutricional</span>
            </button>
          )}
          {product.compositionImageUrl && (
            <button
              onClick={() => setZoomedImage(product.compositionImageUrl!)}
              className="group relative rounded-lg overflow-hidden border border-gray-200 flex-shrink-0 focus:outline-none"
              style={{ width: 72, height: 72 }}
            >
              <Image src={product.compositionImageUrl} alt="Composição" fill className="object-cover" sizes="72px" />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="h-4 w-4 text-white" />
              </div>
              <span className="absolute bottom-0 inset-x-0 text-[8px] text-center text-white font-bold bg-black/60 py-0.5">Composição</span>
            </button>
          )}
        </div>
      )}

      {/* Nutritional data */}
      {product.nutritionalData && (
        <div className="px-4 py-3 border-b border-gray-50">
          <div className="rounded-lg overflow-hidden border border-emerald-100">
            <div className="px-3 py-1.5 bg-emerald-600 text-white">
              <p className="text-[10px] font-bold uppercase">Informação Nutricional</p>
              <p className="text-[9px] text-emerald-100">
                Porção: {product.nutritionalData.portionSize}
                {product.nutritionalData.portionDescription ? ` (${product.nutritionalData.portionDescription})` : ''}
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {product.nutritionalData.nutrients.map((n, i) => (
                <div key={i} className="flex justify-between items-center px-3 py-1">
                  <span className="text-xs text-gray-700">{n.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-900">{n.amount}{n.unit}</span>
                    {n.dailyValue && <span className="text-[10px] text-gray-400">{n.dailyValue}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Composition */}
      {product.compositionText && (
        <div className="px-4 py-3 border-b border-gray-50">
          <p className="text-[10px] font-bold uppercase text-gray-500 mb-1">Composição</p>
          <p className="text-xs text-gray-600 leading-relaxed">{product.compositionText}</p>
        </div>
      )}

      {/* Allergens */}
      {product.detectedAllergens && product.detectedAllergens.length > 0 && (
        <div className="px-4 py-3 flex flex-wrap gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-orange-500 flex-shrink-0 mt-0.5" />
          {product.detectedAllergens.map((a, i) => (
            <span key={i} className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold border border-orange-200">{a}</span>
          ))}
        </div>
      )}

      {!hasData && !hasPhotos && (
        <div className="px-4 py-6 flex flex-col items-center gap-2 text-gray-400">
          <ImageIcon className="h-7 w-7 opacity-20" />
          <p className="text-xs text-center">Sem fotos nem dados transcritos.<br />Adicione fotos da embalagem no cadastro do insumo.</p>
        </div>
      )}

      {/* Zoom lightbox */}
      {zoomedImage && (
        <Dialog open={!!zoomedImage} onOpenChange={() => setZoomedImage(null)}>
          <DialogContent className="max-w-3xl p-2 bg-black border-none">
            <Image src={zoomedImage} alt="Ampliado" width={800} height={1000} className="w-full h-auto object-contain max-h-[85vh] rounded" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function BaseProductFichaModal({ open, onOpenChange, baseProduct, onEdit }: BaseProductFichaModalProps) {
  const { products } = useProducts();
  const { classifications } = useClassifications();
  const { kiosks } = useKiosks();

  const linkedProducts = useMemo(() => {
    if (!baseProduct) return [];
    return products.filter(p => p.baseProductId === baseProduct.id && !p.isArchived);
  }, [products, baseProduct]);

  const classificationName = useMemo(() => {
    if (!baseProduct?.classification) return null;
    return classifications.find(c => c.id === baseProduct.classification)?.name ?? null;
  }, [baseProduct, classifications]);

  const effectivePrice = baseProduct?.lastEffectivePrice?.pricePerUnit ?? baseProduct?.initialCostPerUnit;

  const kiosksWithStockParams = useMemo(() => {
    if (!baseProduct) return [];
    return kiosks
      .filter(k => {
        const level = baseProduct.stockLevels?.[k.id];
        return level && (level.min || level.safetyStock || level.leadTime);
      })
      .map(k => ({ kiosk: k, level: baseProduct.stockLevels[k.id] }));
  }, [baseProduct, kiosks]);

  if (!baseProduct) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[800px] sm:max-w-[800px] w-[95vw] h-[88vh] flex flex-col p-0 overflow-hidden rounded-2xl">
        {/* Header */}
        <div className="px-7 pt-6 pb-4 flex-shrink-0 border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-xl font-black text-gray-900">{baseProduct.name}</DialogTitle>
                {classificationName && (
                  <Badge variant="secondary" className="text-xs">{classificationName}</Badge>
                )}
              </div>
              <DialogDescription className="mt-0.5 text-xs">
                {baseProduct.unit} · {linkedProducts.length} insumo{linkedProducts.length !== 1 ? 's' : ''} vinculado{linkedProducts.length !== 1 ? 's' : ''}
              </DialogDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => onEdit(baseProduct)} className="flex-shrink-0">
              <Edit className="mr-1.5 h-3.5 w-3.5" /> Editar
            </Button>
          </div>
        </div>

        <Tabs defaultValue="dados" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-7 mt-3 mb-0 flex-shrink-0 w-fit">
            <TabsTrigger value="dados" className="gap-1.5"><Info className="h-3.5 w-3.5" />Dados Gerais</TabsTrigger>
            <TabsTrigger value="nutricao" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" />Insumos e Nutrição</TabsTrigger>
          </TabsList>

          {/* Tab: Dados Gerais */}
          <TabsContent value="dados" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="px-7 py-5 space-y-5">
                {/* Identification */}
                <section className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Identificação</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Nome</p>
                      <p className="text-sm font-semibold text-gray-900">{baseProduct.name}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Classificação</p>
                      <p className="text-sm font-semibold text-gray-900">{classificationName || '—'}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Unidade</p>
                      <p className="text-sm font-semibold text-gray-900">{baseProduct.unit}</p>
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Cost & Purchasing */}
                <section className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Parâmetros de Compra</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 rounded-xl p-3 border border-blue-100 flex items-center gap-3">
                      <DollarSign className="h-5 w-5 text-blue-500 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-blue-500 uppercase mb-0.5">Custo por Unidade</p>
                        <p className="text-sm font-black text-blue-900">{formatCurrency(effectivePrice)}</p>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center gap-3">
                      <Clock className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Sugerir Pedido (meses)</p>
                        <p className="text-sm font-black text-gray-900">{baseProduct.consumptionMonths ?? '—'}</p>
                      </div>
                    </div>
                  </div>
                </section>

                {kiosksWithStockParams.length > 0 && (
                  <>
                    <Separator />
                    <section className="space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Estoque por Quiosque</h3>
                      <div className="rounded-xl border border-gray-100 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-100">
                              <th className="text-left px-4 py-2 font-semibold text-gray-500">Quiosque</th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-500">Mín.</th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-500">Segurança</th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-500">Lead Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {kiosksWithStockParams.map(({ kiosk, level }) => (
                              <tr key={kiosk.id}>
                                <td className="px-4 py-2 font-medium text-gray-800">{kiosk.name}</td>
                                <td className="px-3 py-2 text-center text-gray-600">{level.min ?? '—'}</td>
                                <td className="px-3 py-2 text-center text-gray-600">{level.safetyStock ?? '—'}</td>
                                <td className="px-3 py-2 text-center text-gray-600">{level.leadTime ? `${level.leadTime}d` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Tab: Insumos e Nutrição */}
          <TabsContent value="nutricao" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="px-7 py-5 space-y-4">
                {linkedProducts.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
                    <Package className="h-10 w-10 opacity-20" />
                    <p className="text-sm text-center">Nenhum insumo vinculado a este produto base.</p>
                  </div>
                ) : (
                  linkedProducts.map(product => (
                    <NutritionalCard key={product.id} product={product} />
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="flex justify-end px-7 py-3 border-t bg-gray-50 flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
