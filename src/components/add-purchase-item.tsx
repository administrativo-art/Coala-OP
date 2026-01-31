
"use client";

import { useState, useRef, useMemo, useEffect } from 'react';
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
import { Label } from './ui/label';

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
    const [purchaseUnit, setPurchaseUnit] = useState<string>('');
    const priceInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<FormValues>({
        resolver: zodResolver(addItemSchema),
        defaultValues: { productId: '', entityId: '', price: undefined },
    });

    const selectedProductId = form.watch('productId');
    const currentPrice = form.watch('price');
    const selectedProduct = useMemo(() => products.find(p => p.id === selectedProductId), [products, selectedProductId]);

    useEffect(() => {
        if (selectedProduct) {
            setPurchaseUnit(selectedProduct.packageType || selectedProduct.unit);
        } else {
            setPurchaseUnit('');
        }
    }, [selectedProduct]);

    const calculatePricePerBaseUnit = useCallback((price: number, unit: string, product: any, baseProduct: any): number | null => {
        let priceForSinglePackage = price;
        if (unit === product.rotulo_caixa && product.multiplo_caixa && product.multiplo_caixa > 0) {
            priceForSinglePackage = price / product.multiplo_caixa;
        }

        try {
            if (baseProduct.category === 'Unidade') {
                if (product.packageSize > 0) {
                    return priceForSinglePackage / product.packageSize;
                }
            }

            if (product.category === baseProduct.category) {
                const quantityInBaseUnit = convertValue(product.packageSize, product.unit, baseProduct.unit, product.category);
                 if (quantityInBaseUnit > 0) {
                    return priceForSinglePackage / quantityInBaseUnit;
                }
            }
            return null;
        } catch { return null; }
    }, []);

    const alternativePrices = useMemo(() => {
        if (!selectedProduct || !currentPrice || currentPrice <= 0 || !purchaseUnit || !selectedProduct.rotulo_caixa || !selectedProduct.multiplo_caixa) return null;

        let pricePerPackage: number;
        let pricePerBox: number;

        if (purchaseUnit === selectedProduct.rotulo_caixa) {
            pricePerBox = currentPrice;
            pricePerPackage = currentPrice / selectedProduct.multiplo_caixa;
        } else {
            pricePerPackage = currentPrice;
            pricePerBox = currentPrice * selectedProduct.multiplo_caixa;
        }
        
        const baseProduct = baseProducts.find(bp => bp.id === baseProductId);
        if (!baseProduct) return null;
        
        const pricePerBase = calculatePricePerBaseUnit(currentPrice, purchaseUnit, selectedProduct, baseProduct);

        return {
            pricePerPackage,
            pricePerBox,
            packageLabel: selectedProduct.packageType || 'unidade',
            boxLabel: selectedProduct.rotulo_caixa,
            pricePerBase,
            baseUnitLabel: baseProduct.unit
        };
    }, [selectedProduct, currentPrice, purchaseUnit, baseProducts, baseProductId, calculatePricePerBaseUnit]);


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
        if (!selectedProduct) return;
        
        let priceForSinglePackage = values.price;

        if (purchaseUnit === selectedProduct.rotulo_caixa && selectedProduct.multiplo_caixa && selectedProduct.multiplo_caixa > 0) {
            priceForSinglePackage = values.price / selectedProduct.multiplo_caixa;
        }

        await savePrice(null, { ...values, price: priceForSinglePackage, sessionId });
        
        form.reset({
            productId: values.productId,
            entityId: '',
            price: undefined,
        });
        priceInputRef.current?.focus();
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
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 mt-2 p-2 border-t">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-end">
                     <FormField
                        control={form.control}
                        name="productId"
                        render={({ field }) => (
                            <FormItem>
                                <Label>Insumo</Label>
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
                                <Label>Fornecedor</Label>
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
                </div>
                 <div className="flex gap-2 items-end">
                    <FormField
                        control={form.control}
                        name="price"
                        render={({ field }) => (
                        <FormItem className="flex-grow">
                            <Label>Preço</Label>
                            <FormControl>
                            <Input
                                type="text"
                                placeholder="R$ 0,00"
                                value={formatPriceForInput(field.value)}
                                onChange={(e) => handlePriceChange(e, field)}
                                ref={priceInputRef}
                            />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    {selectedProduct?.rotulo_caixa && (
                        <div className="w-40 flex-shrink-0">
                            <Label>Unidade de compra</Label>
                            <Select value={purchaseUnit} onValueChange={setPurchaseUnit}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={selectedProduct.packageType || selectedProduct.unit}>
                                        {selectedProduct.packageType || selectedProduct.unit}
                                    </SelectItem>
                                    <SelectItem value={selectedProduct.rotulo_caixa}>
                                        {selectedProduct.rotulo_caixa}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>

                {alternativePrices && (
                    <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        <p>= {formatCurrency(alternativePrices.pricePerPackage)} por {alternativePrices.packageLabel}</p>
                        <p>= {formatCurrency(alternativePrices.pricePerBox)} por {alternativePrices.boxLabel}</p>
                        {alternativePrices.pricePerBase !== null && (
                            <p className="font-bold">= {formatCurrency(alternativePrices.pricePerBase)} por {alternativePrices.baseUnitLabel}</p>
                        )}
                    </div>
                )}
                
                <div className="flex gap-2">
                    <Button type="submit">Salvar</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>Cancelar</Button>
                </div>
            </form>
        </Form>
    );
}
