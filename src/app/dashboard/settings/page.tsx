

"use client";

import { useState, useRef } from 'react';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useToast } from '@/hooks/use-toast';
import { UserManagement } from '@/components/user-management';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Ticket, Loader2, Eye } from 'lucide-react';
import { labelSizes, type LabelSize } from '@/lib/label-sizes';
import { useAuth } from '@/hooks/use-auth';

function LabelSettings() {
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
        doc.text(locationText, margin, currentY, { maxWidth: textBlockWidth - margin });
        currentY += 4; 
        
        doc.text(`Validade: ${expiryDate}`, margin, currentY, { maxWidth: textBlockWidth - margin });

        doc.save(`etiqueta_exemplo_${selectedSize.name.replace(/\s/g, '_')}.pdf`);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Configurações de Etiqueta</CardTitle>
                <CardDescription>
                    Personalize a aparência das etiquetas de lote.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="space-y-2">
                    <h3 className="text-lg font-medium">Tamanho da Etiqueta</h3>
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
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Eye className="mr-2 h-4 w-4" />} Ver Exemplo
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export default function SettingsPage() {
    const { permissions } = useAuth();
    const canManageUsers = permissions.users.add || permissions.users.edit || permissions.users.delete;

    return (
        <div className="w-full space-y-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold">Configurações</h1>
                <p className="text-muted-foreground">Gerencie usuários, perfis e outras configurações do sistema.</p>
            </div>
            
             <Tabs defaultValue="users" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                    {canManageUsers && <TabsTrigger value="users"><Users className="mr-2 h-4 w-4" /> Usuários e Perfis</TabsTrigger>}
                    <TabsTrigger value="labels"><Ticket className="mr-2 h-4 w-4" /> Etiquetas</TabsTrigger>
                </TabsList>
                {canManageUsers && 
                    <TabsContent value="users" className="mt-4">
                        <UserManagement />
                    </TabsContent>
                }
                <TabsContent value="labels" className="mt-4">
                    <LabelSettings />
                </TabsContent>
            </Tabs>
        </div>
    )
}
