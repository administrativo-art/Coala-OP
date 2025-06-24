"use client"

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Settings } from 'lucide-react';

import { useProducts } from '@/hooks/use-products';
import { convertValue, getUnitsForCategory, units } from '@/lib/conversion';
import { ProductManagementModal } from './product-management-modal';

type InventoryConverterProps = {
  onBack: () => void;
};

export function InventoryConverter({ onBack }: InventoryConverterProps) {
  const { products, loading, addProduct, updateProduct, deleteProduct, getProductFullName } = useProducts();
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const [selectedProductId, setSelectedProductId] = useState<string | undefined>();
  const [value, setValue] = useState<string>('1');
  const [fromUnit, setFromUnit] = useState<string>('Pacote(s)');
  const [toUnit, setToUnit] = useState<string>('');

  useEffect(() => {
    if (!loading && products.length > 0 && !selectedProductId) {
      setSelectedProductId(products[0].id);
    }
  }, [products, loading, selectedProductId]);

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === selectedProductId);
  }, [selectedProductId, products]);

  const availableUnits = useMemo(() => {
    if (!selectedProduct) return [];
    const categoryUnits = getUnitsForCategory(selectedProduct.category);
    return ['Pacote(s)', ...categoryUnits];
  }, [selectedProduct]);

  useEffect(() => {
    if (selectedProduct) {
      const categoryUnits = getUnitsForCategory(selectedProduct.category);
      setFromUnit('Pacote(s)');
      const newToUnit = selectedProduct.unit === categoryUnits[0] 
        ? (categoryUnits[1] || selectedProduct.unit) 
        : categoryUnits[0];
      setToUnit(newToUnit);
    } else if (!loading && products.length === 0) {
        setFromUnit('');
        setToUnit('');
    }
  }, [selectedProduct, loading, products.length]);

  const handleProductChange = (productId: string) => {
    setSelectedProductId(productId);
  };
  
  const result = useMemo(() => {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue) || !selectedProduct || !fromUnit || !toUnit) {
      return '...';
    }

    const isFromUnitValid = fromUnit === 'Pacote(s)' || !!units[selectedProduct.category]?.[fromUnit];
    const isToUnitValid = toUnit === 'Pacote(s)' || !!units[selectedProduct.category]?.[toUnit];

    if (!isFromUnitValid || !isToUnitValid) {
      return '...';
    }

    let valueInProductUnit: number;
    if (fromUnit === 'Pacote(s)') {
      valueInProductUnit = numericValue * selectedProduct.packageSize;
    } else {
      valueInProductUnit = convertValue(numericValue, fromUnit, selectedProduct.unit, selectedProduct.category);
    }
    
    if (toUnit === 'Pacote(s)') {
      if(selectedProduct.packageSize === 0) return '...';
      return (valueInProductUnit / selectedProduct.packageSize).toLocaleString(undefined, { maximumFractionDigits: 5 });
    } else {
      const converted = convertValue(valueInProductUnit, selectedProduct.unit, toUnit, selectedProduct.category);
      return converted.toLocaleString(undefined, { maximumFractionDigits: 5 });
    }
  }, [value, fromUnit, toUnit, selectedProduct]);

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95">
        <CardHeader>
          <Button variant="ghost" size="sm" className="absolute top-4 left-4" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Menu
          </Button>
          <CardTitle className="text-center pt-10 font-headline">Conversão de Inventário</CardTitle>
          <CardDescription className="text-center">Converta o inventário com base em seus produtos cadastrados.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="flex gap-4 items-end">
            <div className="flex-grow space-y-2">
              <Label htmlFor="product">Produto</Label>
              <Select value={selectedProductId} onValueChange={handleProductChange} disabled={products.length === 0}>
                <SelectTrigger id="product">
                  <SelectValue placeholder="Selecione um produto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setIsModalOpen(true)}>
              <Settings className="mr-2 h-4 w-4" /> Gerenciar
            </Button>
          </div>
          
           <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-4">
               <div className="space-y-2">
                 <Label htmlFor="from-unit-inv">De</Label>
                 <div className="flex gap-2">
                    <Input id="value-inv" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Digite o valor" className="w-2/3" disabled={!selectedProduct} />
                    <Select value={fromUnit} onValueChange={setFromUnit} disabled={!selectedProduct}>
                        <SelectTrigger id="from-unit-inv" className="w-1/3"><SelectValue/></SelectTrigger>
                        <SelectContent>
                            {availableUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                        </SelectContent>
                    </Select>
                 </div>
              </div>

              <div className="flex items-center justify-center pt-8">
                <ArrowRight className="h-6 w-6 text-muted-foreground" />
              </div>

              <div className="space-y-2">
                 <Label htmlFor="to-unit-inv">Para</Label>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary">
                    <p className="text-2xl font-bold text-primary font-headline flex-grow">{result}</p>
                     <Select value={toUnit} onValueChange={setToUnit} disabled={!selectedProduct}>
                        <SelectTrigger id="to-unit-inv" className="w-1/3"><SelectValue /></SelectTrigger>
                        <SelectContent>
                             {availableUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
              </div>
           </div>
        </CardContent>
      </Card>
      <ProductManagementModal 
        open={isModalOpen} 
        onOpenChange={setIsModalOpen}
        products={products}
        addProduct={addProduct}
        updateProduct={updateProduct}
        deleteProduct={deleteProduct}
        getProductFullName={getProductFullName}
      />
    </>
  );
}
