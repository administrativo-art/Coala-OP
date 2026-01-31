
"use client";

import { useState } from 'react';
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

    const form = useForm<FormValues>({
        resolver: zodResolver(addItemSchema),
        defaultValues: { productId: '', entityId: '', price: undefined },
    });

    const productsForBase = products.filter(p => p.baseProductId === baseProductId);

    const onSubmit = async (values: FormValues) => {
        await savePrice(null, { ...values, sessionId });
        form.reset();
        setShowForm(false);
    };

    if (!showForm) {
        return <Button variant="outline" size="sm" onClick={() => setShowForm(true)} className="w-full mt-2"><PlusCircle className="mr-2 h-4 w-4" /> Adicionar Cotação</Button>;
    }

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end mt-2 p-2 border-t">
            <Select onValueChange={val => form.setValue('productId', val)}>
                <SelectTrigger><SelectValue placeholder="Selecione o insumo..." /></SelectTrigger>
                <SelectContent>
                    {productsForBase.map(p => <SelectItem key={p.id} value={p.id}>{getProductFullName(p)}</SelectItem>)}
                </SelectContent>
            </Select>
            <Select onValueChange={val => form.setValue('entityId', val)}>
                <SelectTrigger><SelectValue placeholder="Fornecedor..." /></SelectTrigger>
                <SelectContent>
                    {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
            </Select>
            <Input type="number" placeholder="Preço" {...form.register('price')} step="0.01" />
            <Button type="submit">Salvar</Button>
        </form>
    );
}
