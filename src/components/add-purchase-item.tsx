
"use client";

import { useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { usePurchase } from '@/hooks/use-purchase';
import { useProducts } from '@/hooks/use-products';
import { useEntities } from '@/hooks/use-entities';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { PlusCircle, X } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormMessage } from './ui/form';
import { useBaseProducts } from '@/hooks/use-base-products';
import { convertValue } from '@/lib/conversion';
import { cn } from '@/lib/utils';

const addItemSchema = z.object({
  productId: z.string().min(1, "O insumo é obrigatório."),
  entityId: z.string().min(1, "O fornecedor é obrigatório."),
  price: z.coerce.number().min(0.01, "O preço é obrigatório."),
});

type FormValues = z.infer<typeof addItemSchema>;

const formatCurrency = (value: number | null) => {
    if (value === null || !value || isNaN(value)) return 'R$ 0,00';
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};


export function AddPurchaseItem({ baseProductId, sessionId }: { baseProductId: string, sessionId: string }) {
    const { savePrice } = usePurchase();
    const { products, getProductFullName } = useProducts();
    const { entities } = useEntities();
    const { baseProducts } = useBaseProducts();
    const [showForm, setShowForm] = useState(false);
    const priceInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(addItemSchema),
        defaultValues: { productId: '', entityId: '', price: undefined },
    });

    const selectedProductId = form.watch('productId');
    const currentPrice = form.watch('price');

    const pricePerUnit = useMemo(() => {
        if (!selectedProductId || !currentPrice || currentPrice <= 0) return null;
        const product = products.find(p => p.id === selectedProductId);
        const baseProduct = baseProducts.find(bp => bp.id === baseProductId);
        if (!product || !baseProduct) return null;

        try {
            if (baseProduct.category === 'Unidade') {
                if (product.packageSize > 0) {
                    return currentPrice / product.packageSize;
                }
            }

            if (product.category === baseProduct.category) {
                const quantityInBaseUnit = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 if (quantityInBaseUnit > 0) {
                    return currentPrice / quantityInBaseUnit;
                }
            }
            return null;
        } catch { return null; }
    }, [selectedProductId, currentPrice, products, baseProducts, baseProductId]);

    const baseProductUnit = useMemo(() => {
        return baseProducts.find(bp => bp.id === baseProductId)?.unit;
    }, [baseProducts, baseProductId]);


    const productsForBase = products.filter(p => p.baseProductId === baseProductId);

    const handleShowForm = () => {
        setShowForm(true);
        setTimeout(() => {
            priceInputRef.current?.focus();
        }, 100);
    }
    
    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>, field: any) => {
        const value = e.target.value;
        const digitsOnly = value.replace(/\D/g, '');
        if (digitsOnly === '') {
            field.onChange(undefined);
            return;
        }

        const numericValue = parseInt(digitsOnly, 10) / 100;
        field.onChange(numericValue);
    };

    const formatPriceForInput = (value: number | undefined) => {
        if (value === undefined || value === null) return '';
        return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const onSubmit = async (values: FormValues) => {
        await savePrice(null, { ...values, sessionId });
        form.reset({
            productId: '',
            entityId: '',
            price: undefined,
        });
    };
    
    const handleCancel = () => {
        form.reset({
            productId: '',
            entityId: '',
            price: undefined,
        });
        setShowForm(false);
    }

    if (!showForm) {
        return <Button variant="outline" size="sm" onClick={handleShowForm} className="w-full mt-2"><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Cotação</Button>;
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-[2fr,2fr,1.5fr,1.5fr,auto] gap-2 items-end mt-2 p-2 border-t">
                <FormField
                    control={form.control}
                    name="productId"
                    render={({ field }) => (
                        <FormItem>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                            <SelectTrigger className="w-full"><SelectValue placeholder="Selecione o insumo..." /></SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {productsForBase.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <FormMessage/>
                        </FormItem>
                    )}
                />
                 <FormField
                    control={form.control}
                    name="entityId"
                    render={({ field }) => (
                         <FormItem>
                         <Select onValueChange={field.onChange} value={field.value}>
                             <FormControl>
                             <SelectTrigger className="w-full"><SelectValue placeholder="Fornecedor..." /></SelectTrigger>
                             </FormControl>
                             <SelectContent>
                                 {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                             </SelectContent>
                         </Select>
                         <FormMessage/>
                         </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                    <FormItem>
                        <FormControl>
                        <Input
                            type="text"
                            placeholder="Preço (R$)"
                            value={formatPriceForInput(field.value)}
                            onChange={(e) => handlePriceChange(e, field)}
                            ref={priceInputRef}
                        />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                 <div className="h-10 flex items-center justify-center p-2 border rounded-md bg-muted text-sm text-muted-foreground">
                    {pricePerUnit !== null ? (
                        <span className="font-semibold text-foreground whitespace-nowrap">{formatCurrency(pricePerUnit)} / {baseProductUnit}</span>
                    ) : (
                        <span>-</span>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button type="submit">Salvar</Button>
                    <Button type="button" variant="ghost" size="icon" onClick={handleCancel}><X className="h-4 w-4" /></Button>
                </div>
            </form>
        </Form>
    );
}

