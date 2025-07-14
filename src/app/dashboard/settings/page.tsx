
"use client";

import { useState, useRef } from 'react';
import Image from 'next/image';
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { useAuth } from '@/hooks/use-auth';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useToast } from '@/hooks/use-toast';
import { UserManagement } from '@/components/user-management';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Ticket, Upload, Trash2, Loader2, Eye } from 'lucide-react';
import { resizeImage } from '@/lib/image-utils';
import { labelSizes, type LabelSize } from '@/lib/label-sizes';

function LabelSettings() {
    const { logoUrl, labelSizeId, updateLogo, updateLabelSize, loading } = useCompanySettings();
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) { // 2MB limit
                toast({ variant: 'destructive', title: 'Arquivo muito grande', description: 'Por favor, selecione um arquivo menor que 2MB.' });
                return;
            }
            const reader = new FileReader();
            reader.onloadend = async () => {
                try {
                    const resizedDataUrl = await resizeImage(reader.result as string, 200, 100);
                    await updateLogo(resizedDataUrl);
                    toast({ title: 'Logo atualizado com sucesso!' });
                } catch (error) {
                    toast({ variant: 'destructive', title: 'Erro ao processar imagem.' });
                }
            };
            reader.readAsDataURL(file);
        }
    };
    
    const handleRemoveLogo = async () => {
        await updateLogo(null);
        toast({ title: 'Logo removido.' });
    };
    
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

        let currentY = margin + 1;

        if (logoUrl) {
          try {
            const logoMaxHeight = availableHeight * 0.2;
            const logoMaxWidth = textBlockWidth * 0.4;
            const img = new (window as any).Image();
            img.src = logoUrl;
            await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
            
            let logoWidth = img.width;
            let logoHeight = img.height;
            let ratio = logoWidth / logoHeight;
            
            if (logoHeight > logoMaxHeight) {
                logoHeight = logoMaxHeight;
                logoWidth = logoHeight * ratio;
            }
            if (logoWidth > logoMaxWidth) {
                logoWidth = logoMaxWidth;
                logoHeight = logoWidth / ratio;
            }

            doc.addImage(logoUrl, 'JPEG', margin, currentY, logoWidth, logoHeight);
            currentY += logoHeight + 1;
            doc.setDrawColor(220, 220, 220);
            doc.line(margin, currentY, textBlockWidth, currentY);
            currentY += 2;
          } catch (e) {
            console.error("Could not add logo", e);
          }
        }
        
        const productName = "Produto Exemplo - 500g";
        const lotNumber = "LOTE-12345";
        const expiryDate = "31/12/2099";
        const locationText = "Quiosque Teste / Prateleira A";

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(productName, margin, currentY, { maxWidth: textBlockWidth - margin });
        currentY += doc.getTextDimensions(productName, { maxWidth: textBlockWidth - margin }).h + 1;

        doc.setDrawColor(220, 220, 220);
        doc.line(margin, currentY, textBlockWidth, currentY);
        currentY += 2;

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(`Lote: ${lotNumber}`, margin, currentY);
        currentY += 3;
        doc.text(locationText, margin, currentY, { maxWidth: textBlockWidth - margin });
        currentY += 3;

        doc.setDrawColor(220, 220, 220);
        doc.line(margin, currentY, textBlockWidth, currentY);
        currentY += 2;
        
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`VALIDADE: ${expiryDate}`, margin, currentY, { maxWidth: textBlockWidth - margin });

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
            <CardContent className="space-y-6">
                <div>
                    <h3 className="text-lg font-medium">Logotipo da Empresa</h3>
                    <p className="text-sm text-muted-foreground">Este logo aparecerá no topo de todas as etiquetas impressas.</p>
                </div>
                <div className="flex flex-col sm:flex-row items-start gap-6">
                    <div className="w-48 h-24 rounded-md border-2 border-dashed bg-muted flex items-center justify-center">
                        {loading ? (
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        ) : logoUrl ? (
                            <Image src={logoUrl} alt="Logo da empresa" width={192} height={96} className="object-contain p-2" />
                        ) : (
                            <span className="text-sm text-muted-foreground">Sem logo</span>
                        )}
                    </div>
                    <div className="flex flex-col gap-2">
                        <Button onClick={() => fileInputRef.current?.click()} disabled={loading}>
                            <Upload className="mr-2 h-4 w-4" /> Enviar novo logo
                        </Button>
                        <Input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            accept="image/png, image/jpeg, image/svg+xml" 
                            onChange={handleFileUpload}
                        />
                        {logoUrl && (
                            <Button variant="destructive" onClick={handleRemoveLogo} disabled={loading}>
                                <Trash2 className="mr-2 h-4 w-4" /> Remover logo
                            </Button>
                        )}
                    </div>
                </div>
                 <div className="border-t pt-6 space-y-2">
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
                            <Eye className="mr-2 h-4 w-4" /> Ver Exemplo
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
