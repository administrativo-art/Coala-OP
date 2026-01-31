"use client";

import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { usePurchase } from '@/hooks/use-purchase';
import { useProducts } from '@/hooks/use-products';
import { useEntities } from '@/hooks/use-entities';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { PlusCircle } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormMessage } from './ui/form';

const addItemSchema = z.object({
  productId: z.string().min(1, "O insumo é obrigatório."),
  entityId: z.string().min(1, "O fornecedor é obrigatório."),
  price: z.coerce.number().min(0.01, "O preço é obrigatório."),
});

type FormValues = z.infer<typeof addItemSchema>;

export function AddPurchaseItem({ baseProductId, sessionId }: { baseProductId: string, sessionId: string }) {
    const { savePrice } = usePurchase();
    const { products, getProductFullName } = useProducts();
    const { entities } = useEntities();
    const [showForm, setShowForm] = useState(false);
    const priceInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(addItemSchema),
        defaultValues: { productId: '', entityId: '', price: undefined },
    });

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

    const formatPrice = (value: number | undefined) => {
        if (value === undefined || value === null) return '';
        return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const onSubmit = async (values: FormValues) => {
        await savePrice(null, { ...values, sessionId });
        form.reset();
        setShowForm(false);
    };

    if (!showForm) {
        return <Button variant="outline" size="sm" onClick={handleShowForm} className="w-full mt-2"><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Cotação</Button>;
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end mt-2 p-2 border-t">
                <FormField
                    control={form.control}
                    name="productId"
                    render={({ field }) => (
                        <FormItem>
                        <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                            <SelectTrigger><SelectValue placeholder="Selecione o insumo..." /></SelectTrigger>
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
                             <SelectTrigger><SelectValue placeholder="Fornecedor..." /></SelectTrigger>
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
                            value={formatPrice(field.value)}
                            onChange={(e) => handlePriceChange(e, field)}
                            ref={priceInputRef}
                        />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <Button type="submit">Salvar</Button>
            </form>
        </Form>
    );
}
