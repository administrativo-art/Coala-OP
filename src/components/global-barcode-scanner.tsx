
"use client";

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from './ui/button';
import { Camera } from 'lucide-react';
import { useProducts } from '@/hooks/use-products';
import { ScannedItemActionsModal } from './scanned-item-actions-modal';
import { type Product } from '@/types';
import { useToast } from '@/hooks/use-toast';


const BarcodeScannerModal = dynamic(
  () => import('@/components/barcode-scanner-modal').then(mod => mod.BarcodeScannerModal),
  { ssr: false }
);

export function GlobalBarcodeScanner() {
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
    const { products } = useProducts();
    const { toast } = useToast();

    const handleScanSuccess = (decodedText: string) => {
        setIsScannerOpen(false);
        const product = products.find(p => p.barcode === decodedText && !p.isArchived);
        if (product) {
            setScannedProduct(product);
        } else {
            toast({
                variant: 'destructive',
                title: 'Insumo não encontrado',
                description: 'Nenhum insumo ativo corresponde ao código de barras escaneado.'
            });
        }
    };
    
    return (
        <>
            <Button variant="outline" size="icon" onClick={() => setIsScannerOpen(true)}>
                <Camera className="h-5 w-5" />
                <span className="sr-only">Escanear código de barras</span>
            </Button>
            
            <BarcodeScannerModal 
                open={isScannerOpen}
                onOpenChange={setIsScannerOpen}
                onScanSuccess={handleScanSuccess}
            />

            <ScannedItemActionsModal
                product={scannedProduct}
                onOpenChange={() => setScannedProduct(null)}
            />
        </>
    )
}
