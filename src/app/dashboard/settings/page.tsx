
"use client";

import { useState, useRef } from 'react';
import Image from 'next/image';
import { useAuth } from '@/hooks/use-auth';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { useToast } from '@/hooks/use-toast';
import { UserManagement } from '@/components/user-management';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Ticket, Upload, Trash2, Loader2 } from 'lucide-react';
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
