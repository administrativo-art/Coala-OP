
"use client"

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRight, ArrowLeftRight, Scale } from 'lucide-react';
import { unitCategories, getUnitsForCategory, convertValue, type UnitCategory } from '@/lib/conversion';

export function MeasureConverter() {
  const [category, setCategory] = useState<UnitCategory>('Massa');
  const [value, setValue] = useState<string>('1');
  const [fromUnit, setFromUnit] = useState<string>('kg');
  const [toUnit, setToUnit] = useState<string>('g');

  const availableUnits = useMemo(() => {
    return getUnitsForCategory(category);
  }, [category]);

  const handleCategoryChange = (val: string) => {
    const newCat = val as UnitCategory;
    setCategory(newCat);
    const newUnits = getUnitsForCategory(newCat);
    setFromUnit(newUnits[0]);
    setToUnit(newUnits[1] || newUnits[0]);
  };

  const handleSwap = () => {
    setFromUnit(toUnit);
    setToUnit(fromUnit);
  };

  const result = useMemo(() => {
    const numericValue = parseFloat(value);
    if (isNaN(numericValue)) return '...';
    try {
      const converted = convertValue(numericValue, fromUnit, toUnit, category);
      return converted.toLocaleString('pt-BR', { maximumFractionDigits: 5 });
    } catch (e) {
      return 'Erro';
    }
  }, [value, fromUnit, toUnit, category]);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Conversão padrão</h1>
        <p className="text-muted-foreground">Converta unidades de medida tradicionais.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
            <Scale /> Conversor de Medidas
          </CardTitle>
          <CardDescription className="text-center">Realize conversões rápidas entre diferentes unidades.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2">
            <Label htmlFor="category">Categoria</Label>
            <Select value={category} onValueChange={handleCategoryChange}>
              <SelectTrigger id="category">
                <SelectValue placeholder="Selecione a categoria" />
              </SelectTrigger>
              <SelectContent>
                {unitCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="from-unit">De</Label>
              <div className="flex gap-2">
                <Input
                  id="value"
                  type="number"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Valor"
                  className="w-2/3"
                />
                <Select value={fromUnit} onValueChange={setFromUnit}>
                  <SelectTrigger id="from-unit" className="w-1/3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUnits.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-center pt-8">
              <Button variant="ghost" size="icon" onClick={handleSwap}>
                <ArrowLeftRight className="h-5 w-5 text-muted-foreground hover:text-primary" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="to-unit">Para</Label>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary">
                <p className="text-2xl font-bold text-primary font-headline flex-grow">{result}</p>
                <Select value={toUnit} onValueChange={setToUnit}>
                  <SelectTrigger id="to-unit" className="w-1/3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUnits.map((u) => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
