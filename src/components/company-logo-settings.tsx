"use client";

import { useState } from 'react';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { uploadFile } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, ImageIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';

export function CompanyLogoSettings() {
    const { logoUrl, updateLogoUrl } = useCompanySettings();
    const [uploading, setUploading] = useState(false);
    const { toast } = useToast();

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            // Define o caminho no Storage (pastas serão criadas automaticamente)
            const path = `settings/company/logo_${Date.now()}`;
            const downloadUrl = await uploadFile(file, path);
            
            // Atualiza o Firestore com a nova URL
            await updateLogoUrl(downloadUrl);
            
            toast({ title: "Sucesso!", description: "A logo foi atualizada e será refletida em todo o sistema." });
        } catch (error) {
            toast({ title: "Erro no upload", description: "Verifique as regras do Firebase Storage.", variant: "destructive" });
        } finally {
            setUploading(false);
        }
    };

    return (
        <Card className="border-white/20 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
                <CardTitle>Logo da Empresa</CardTitle>
                <CardDescription>Gerencie a identidade visual da Sidebar e Relatórios.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
                <div className="relative w-40 h-40 border-2 border-dashed rounded-2xl flex items-center justify-center bg-muted/30 overflow-hidden">
                    {logoUrl ? (
                        <Image src={logoUrl} alt="Logo Atual" fill className="object-contain p-4" />
                    ) : (
                        <ImageIcon className="w-12 h-12 text-muted-foreground/40" />
                    )}
                </div>
                <div className="flex gap-2">
                    <Input id="logo-input" type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                    <Button asChild variant="outline" disabled={uploading}>
                        <label htmlFor="logo-input" className="cursor-pointer">
                            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            {uploading ? "Enviando..." : "Alterar Logo"}
                        </label>
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
