"use client";

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ResultCenterOption } from '@/lib/purchasing-financial-options';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: ResultCenterOption[];
  placeholder: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  triggerClassName?: string;
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function ResultCenterSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Buscar centro de resultado...',
  disabled = false,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = useMemo(() => options.find((option) => option.id === value) ?? null, [options, value]);
  const normalizedSearch = normalizeSearch(search);
  const filteredOptions = useMemo(
    () => options
      .filter((option) => normalizeSearch(option.name).includes(normalizedSearch))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [normalizedSearch, options],
  );

  function handleSelect(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setSearch('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('w-full justify-between font-normal hover:bg-background hover:text-foreground', triggerClassName)}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>{selected?.name ?? placeholder}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden p-2"
        align="start"
        sideOffset={4}
      >
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 pl-8"
          />
        </div>
        <div className="max-h-[min(16rem,calc(var(--radix-popover-content-available-height)-4.5rem))] overflow-y-auto pr-1">
          <div className="space-y-0.5">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = value === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted',
                      isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90',
                    )}
                    onClick={() => handleSelect(option.id)}
                  >
                    <span className="truncate">{option.name}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })
            ) : (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                Nenhum centro encontrado.
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
