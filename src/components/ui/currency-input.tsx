import * as React from 'react';
import { cn } from '@/lib/utils';

interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number | string;
  onChange: (value: number) => void;
  decimalPlaces?: number;
}

function formatValue(value: string | number, decimalPlaces: number): string {
  if (value === '' || value === 0) return '';
  const divisor = 10 ** decimalPlaces;
  const numberValue = typeof value === 'string' ? parseFloat(value.replace(/[^\d]/g, '')) / divisor : value;
  if (isNaN(numberValue)) return '';
  return numberValue.toLocaleString('pt-BR', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

export function CurrencyInput({ value, onChange, className, decimalPlaces = 2, ...props }: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = React.useState(() => formatValue(value, decimalPlaces));

  React.useEffect(() => {
    setDisplayValue(formatValue(value, decimalPlaces));
  }, [value, decimalPlaces]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/[^\d]/g, '');
    const numberValue = parseFloat(rawValue) / (10 ** decimalPlaces);

    if (isNaN(numberValue)) {
      onChange(0);
      setDisplayValue('');
      return;
    }

    onChange(numberValue);
    setDisplayValue(formatValue(numberValue, decimalPlaces));
  };

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">R$</span>
      <input
        {...props}
        type="text"
        inputMode="numeric"
        value={displayValue}
        onChange={handleChange}
        placeholder={decimalPlaces === 3 ? '0,000' : '0,00'}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      />
    </div>
  );
}
