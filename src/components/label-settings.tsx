
"use client";

import { useState } from 'react';
import jsPDF from 'jspdf';
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
        const selectedSize = labelSizes.find(s => s.id === labelSizeId) || labelSizes.find(s => s.id === '6080') || labelSizes[0];
        
        const doc = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: [selectedSize.width, selectedSize.height]
        });

        const margin = 2;
        const availableWidth = selectedSize.width - 2 * margin;
        const availableHeight = selectedSize.height - 2 * margin;
        const qrCodeSize = Math.min(availableHeight, availableWidth * 0.3);
        const qrCodeX = selectedSize.width - qrCodeSize - margin;
        const qrCodeY = (selectedSize.height - qrCodeSize) / 2;

        try {
          const qrCodeDataUrl = await QRCode.toDataURL('https://coala.com', { errorCorrectionLevel: 'H', margin: 1, width: 256 });
          doc.addImage(qrCodeDataUrl, 'PNG', qrCodeX, qrCodeY, qrCodeSize, qrCodeSize);
        } catch (err) {
          console.error("Failed to generate QR Code", err);
        }

        const textBlockWidth = availableWidth - qrCodeSize - margin;
        const separatorX = qrCodeX - margin / 2;
        doc.setDrawColor(200, 200, 200);
        doc.line(separatorX, margin, separatorX, selectedSize.height - margin);

        let currentY = margin + 4;
        
        const productName = "Produto Exemplo - 500g";
        const lotNumber = "LOTE-12345";
        const expiryDate = "31/12/2099";
        const locationText = "Quiosque Teste / Prateleira A";

        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text(productName, margin, currentY, { maxWidth: textBlockWidth - margin });
        currentY += doc.getTextDimensions(productName, { maxWidth: textBlockWidth - margin }).h + 3;

        doc.setFont('helvetica', 'normal');
        doc.text(`Lote: ${lotNumber}`, margin, currentY);
        currentY += 4;
        
        const locationDimensions = doc.getTextDimensions(locationText, { maxWidth: textBlockWidth - margin });
        doc.text(locationText, margin, currentY, { maxWidth: textBlockWidth - margin });
        currentY += locationDimensions.h + 4; 
        
        doc.text(`Validade: ${expiryDate}`, margin, currentY, { maxWidth: textBlockWidth - margin });

        doc.save(`etiqueta_exemplo_${selectedSize.name.replace(/\s/g, '_')}.pdf`);
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
