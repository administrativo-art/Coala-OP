
"use client"

import { useState, useMemo, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { ArrowRight } from 'lucide-react';
import { type Product, type PredefinedConversionItem } from '@/types';
import { useProducts } from '@/hooks/use-products';
import { units, convertValue } from '@/lib/conversion';

type PredefinedListItemConverterProps = {
  item: PredefinedConversionItem;
  products: Product[];
  value: string;
  onValueChange: (value: string, result: string) => void;
};

export function PredefinedListItemConverter({ item, products, value, onValueChange }: PredefinedListItemConverterProps) {
  const { getProductFullName } = useProducts();

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === item.productId);
  }, [item.productId, products]);

  const result = useMemo(() => {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue) || !selectedProduct || !item.fromUnit || !item.toUnit) {
      return '...';
    }

    const isFromUnitValid = item.fromUnit === 'Pacote(s)' || !!units[selectedProduct.category]?.[item.fromUnit];
    const isToUnitValid = item.toUnit === 'Pacote(s)' || !!units[selectedProduct.category]?.[item.toUnit];

    if (!isFromUnitValid || !isToUnitValid) {
      return '...';
    }
    
    let valueInProductUnit: number;
    if (item.fromUnit === 'Pacote(s)') {
      valueInProductUnit = numericValue * selectedProduct.packageSize;
    } else {
      valueInProductUnit = convertValue(numericValue, item.fromUnit, selectedProduct.unit, selectedProduct.category);
    }
    
    let finalResult;
    if (item.toUnit === 'Pacote(s)') {
      if(selectedProduct.packageSize === 0) return '...';
      finalResult = (valueInProductUnit / selectedProduct.packageSize);
    } else {
      finalResult = convertValue(valueInProductUnit, selectedProduct.unit, item.toUnit, selectedProduct.category);
    }
    return finalResult.toLocaleString(undefined, { maximumFractionDigits: 5 });

  }, [value, item, selectedProduct]);
  
  useEffect(() => {
    onValueChange(value, result);
  }, [value, result, onValueChange]);

  if (!selectedProduct) {
    return <div className="text-sm text-destructive p-3 border rounded-md bg-destructive/10">Produto não encontrado. Este item pode ter sido removido.</div>;
  }

  return (
    <div className="p-3 border rounded-md bg-secondary/50">
        <p className="font-medium mb-2">{getProductFullName(selectedProduct)}</p>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex items-center gap-2">
                <Input type="number" value={value} onChange={(e) => onValueChange(e.target.value, result)} className="flex-grow bg-background" />
                <span className="text-sm font-semibold">{item.fromUnit}</span>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="flex items-center gap-2 p-2 rounded-md bg-background">
                <p className="text-xl font-bold text-primary font-headline flex-grow text-center">{result}</p>
                 <span className="text-sm font-semibold">{item.toUnit}</span>
            </div>
        </div>
    </div>
  );
}
