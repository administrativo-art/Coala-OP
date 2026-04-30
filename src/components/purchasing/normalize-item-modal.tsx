"use client";

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Check, ChevronsUpDown, Loader2, Link2, PlusCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { useBaseProducts } from '@/hooks/use-base-products';
import { useQuotations } from '@/hooks/use-quotations';
import { unitCategories, type QuotationItem } from '@/types';
import { db } from '@/lib/firebase';
import { arrayUnion, doc, updateDoc } from 'firebase/firestore';

const newItemSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório.'),
  category: z.enum(unitCategories),
  unit: z.string().min(1, 'Unidade obrigatória.'),
});

type NewItemValues = z.infer<typeof newItemSchema>;

const UNIT_OPTIONS: Record<string, string[]> = {
  Volume: ['L', 'mL'],
  Massa: ['kg', 'g'],
  Unidade: ['un', 'pacote'],
  Embalagem: ['un', 'pacote', 'cx'],
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  quotationId: string;
  item: QuotationItem;
}

export function NormalizeItemModal({ open, onOpenChange, quotationId, item }: Props) {
  const { baseProducts } = useBaseProducts();
  const { normalizeItem } = useQuotations();

  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [comboOpen, setComboOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  const form = useForm<NewItemValues>({
    resolver: zodResolver(newItemSchema),
    defaultValues: { name: item.freeText ?? '', category: 'Massa', unit: 'kg' },
  });

  const category = form.watch('category');

  const handleLink = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await normalizeItem(quotationId, item.id, selectedId);
      if (item.barcode) {
        await updateDoc(doc(db, 'baseProducts', selectedId), {
          barcode: item.barcode,
          barcodes: arrayUnion(item.barcode),
        });
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (values: NewItemValues) => {
    setSaving(true);
    try {
      const { addDoc, collection } = await import('firebase/firestore');
      const ref = await addDoc(collection(db, 'baseProducts'), {
        name: values.name,
        category: values.category,
        unit: values.unit,
        stockLevels: {},
        ...(item.barcode ? { barcode: item.barcode, barcodes: [item.barcode] } : {}),
      });
      await normalizeItem(quotationId, item.id, ref.id);
      onOpenChange(false);
      form.reset();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Normalizar item livre</DialogTitle>
          <DialogDescription>
            Vincule <strong className="text-foreground">{item.freeText}</strong> a um insumo cadastrado
            ou cadastre um novo insumo.
            {item.barcode && (
              <span className="block mt-1">
                EAN lido: <Badge variant="outline" className="font-mono text-xs">{item.barcode}</Badge>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            variant={mode === 'link' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => setMode('link')}
          >
            <Link2 className="mr-2 h-4 w-4" />
            Vincular existente
          </Button>
          <Button
            variant={mode === 'create' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => setMode('create')}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Cadastrar novo
          </Button>
        </div>

        <Separator />

        {mode === 'link' ? (
          <div className="space-y-4">
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                  {selectedId
                    ? (baseProducts.find((p) => p.id === selectedId)?.name ?? '—')
                    : 'Buscar insumo...'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command>
                  <CommandInput placeholder="Buscar insumo..." />
                  <CommandList>
                    <CommandEmpty>Nenhum insumo encontrado.</CommandEmpty>
                    <CommandGroup>
                      {baseProducts
                        .filter((p) => !p.isArchived)
                        .map((p) => (
                          <CommandItem
                            key={p.id}
                            value={p.name}
                            onSelect={() => {
                              setSelectedId(p.id);
                              setComboOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedId === p.id ? 'opacity-100' : 'opacity-0',
                              )}
                            />
                            <span>{p.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">{p.unit}</span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <Button
              className="w-full"
              disabled={!selectedId || saving}
              onClick={handleLink}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Vincular insumo
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do insumo</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Morango congelado" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoria</FormLabel>
                    <Select
                      onValueChange={(v) => {
                        field.onChange(v);
                        form.setValue('unit', UNIT_OPTIONS[v]?.[0] ?? '');
                      }}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {unitCategories.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidade base</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(UNIT_OPTIONS[category] ?? []).map((u) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cadastrar e vincular
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
