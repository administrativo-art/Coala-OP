"use client"
import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { convertValue, getUnitsForCategory } from '@/lib/conversion';
import { unitCategories, UnitCategory } from '@/types';

type StandardConverterProps = {
  onBack: () => void;
};

export function StandardConverter({ onBack }: StandardConverterProps) {
  const [category, setCategory] = useState<UnitCategory>('Volume');
  const [value, setValue] = useState<string>('1');
  const [fromUnit, setFromUnit] = useState<string>('L');
  const [toUnit, setToUnit] = useState<string>('mL');

  const availableUnits = useMemo(() => getUnitsForCategory(category), [category]);

  useEffect(() => {
    const newUnits = getUnitsForCategory(category);
    setFromUnit(newUnits[0]);
    setToUnit(newUnits.length > 1 ? newUnits[1] : newUnits[0]);
    setValue('1');
  }, [category]);

  const result = useMemo(() => {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue)) return '...';
    const converted = convertValue(numericValue, fromUnit, toUnit, category);
    return converted.toLocaleString(undefined, { maximumFractionDigits: 5 });
  }, [value, fromUnit, toUnit, category]);

  const handleSwap = () => {
    setFromUnit(toUnit);
    setToUnit(fromUnit);
    setValue(result === '...' ? '1' : result.replace(/,/g, ''));
  };

  return (
    <Card className="w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95">
      <CardHeader>
        <Button variant="ghost" size="sm" className="absolute top-4 left-4" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar ao Menu
        </Button>
        <CardTitle className="text-center pt-10 font-headline">Conversão Padrão</CardTitle>
        <CardDescription className="text-center">Converta entre unidades de medida padrão.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 p-6">
        <div className="space-y-2">
          <Label htmlFor="category">Categoria</Label>
          <Select value={category} onValueChange={(val) => setCategory(val as UnitCategory)}>
            <SelectTrigger id="category">
              <SelectValue placeholder="Selecione uma categoria" />
            </SelectTrigger>
            <SelectContent>
              {unitCategories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="from-unit">De</Label>
            <div className="flex gap-2">
                <Input id="value" type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Digite o valor" className="w-2/3" />
                <Select value={fromUnit} onValueChange={setFromUnit}>
                    <SelectTrigger id="from-unit" className="w-1/3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {availableUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
          </div>

          <div className="flex items-center justify-center pt-8">
            <Button variant="ghost" size="icon" onClick={handleSwap}>
                <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="to-unit">Para</Label>
             <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary">
                <p className="text-2xl font-bold text-primary font-headline flex-grow">{result}</p>
                 <Select value={toUnit} onValueChange={setToUnit}>
                    <SelectTrigger id="to-unit" className="w-1/3"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {availableUnits.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
