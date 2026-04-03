import * as React from 'react';
import { cn } from '@/lib/utils';

interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number | string;
  onChange: (value: number) => void;
}

function toDisplay(raw: number | string): string {
  const n = typeof raw === 'string' ? parseFloat(raw.replace(',', '.')) : raw;
  if (isNaN(n) || raw === '' || raw === 0) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CurrencyInput({ value, onChange, className, ...props }: CurrencyInputProps) {
  const [display, setDisplay] = React.useState(() => toDisplay(value));
  const [focused, setFocused] = React.useState(false);

  // Sync when value changes externally (e.g. form reset)
  React.useEffect(() => {
    if (!focused) setDisplay(toDisplay(value));
  }, [value, focused]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Allow digits, comma, dot, and minus
    setDisplay(raw);
    // Parse: replace comma with dot, remove thousand separators
    const normalized = raw.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    onChange(isNaN(num) ? 0 : num);
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(false);
    const normalized = e.target.value.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    setDisplay(isNaN(num) || num === 0 ? '' : toDisplay(num));
    props.onBlur?.(e);
  }

  function handleFocus(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(true);
    // Show raw number for editing (replace dots, use comma)
    const normalized = display.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(normalized);
    setDisplay(isNaN(num) || num === 0 ? '' : String(num).replace('.', ','));
    props.onFocus?.(e);
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">R$</span>
      <input
        {...props}
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
      />
    </div>
  );
}
