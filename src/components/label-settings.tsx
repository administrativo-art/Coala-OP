
"use client";

import { useState } from 'react';

import QRCode from 'qrcode';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Eye } from 'lucide-react';
import { labelSizes, type LabelSize } from '@/lib/label-sizes';

interface LabelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LabelSettingsModal({ isOpen, onClose }: LabelSettingsModalProps) {
    const { labelSizeId, updateLabelSize, loading } = useCompanySettings();
    const { toast } = useToast();

    const handleSizeChange = async (sizeId: string) => {
        await updateLabelSize(sizeId);
        toast({ title: 'Tamanho da etiqueta atualizado.' });
    };

    const handlePrintSample = async () => {
        toast({ title: "Impressão de etiquetas em atualização." });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Configurações de Etiqueta</DialogTitle>
                    <DialogDescription>
                        Personalize a aparência das etiquetas de lote. A alteração será salva para toda a empresa.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-2">
                    <h3 className="text-lg font-medium">Tamanho da etiqueta</h3>
                    <p className="text-sm text-muted-foreground">
                        Selecione o modelo de etiqueta que você utiliza para a impressão.
                    </p>
                    <div className="flex items-center gap-2">
                        <Select value={labelSizeId || ''} onValueChange={handleSizeChange} disabled={loading}>
                            <SelectTrigger className="w-full max-w-sm">
                                <SelectValue placeholder="Selecione um tamanho..." />
                            </SelectTrigger>
                            <SelectContent>
                                {labelSizes.map((size: LabelSize) => (
                                    <SelectItem key={size.id} value={size.id}>
                                        {size.name} ({size.width}mm x {size.height}mm)
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button variant="outline" onClick={handlePrintSample} disabled={loading}>
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Eye className="mr-2 h-4 w-4" />} Ver exemplo
                        </Button>
                    </div>
                </div>
                 <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Fechar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
