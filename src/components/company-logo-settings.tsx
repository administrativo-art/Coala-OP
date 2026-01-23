
"use client";

import { useState } from 'react';
import { useCompanySettings } from '@/hooks/use-company-settings';
import { uploadFile } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, Image as ImageIcon } from 'lucide-react';
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
            
            toast({ title: "Sucesso!", description: "Logo atualizada com sucesso." });
        } catch (error) {
            toast({ title: "Erro", description: "Falha no upload.", variant: "destructive" });
        } finally {
            setUploading(false);
        }
    };

    return (
        <Card className="border-white/20 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
                <CardTitle>Identidade Visual</CardTitle>
                <CardDescription>Carregue a logo da sua empresa.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
                <div className="relative w-32 h-32 border-2 border-dashed rounded-xl flex items-center justify-center overflow-hidden bg-muted">
                    {logoUrl ? (
                        <Image src={logoUrl} alt="Logo" fill className="object-contain p-2" />
                    ) : (
                        <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    )}
                </div>
                <label className="cursor-pointer">
                    <Input type="file" className="hidden" accept="image/*" onChange={handleFileChange} disabled={uploading} />
                    <Button asChild variant="outline" disabled={uploading}>
                        <span>
                            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            {uploading ? "Enviando..." : "Selecionar Logo"}
                        </span>
                    </Button>
                </label>
            </CardContent>
        </Card>
    );
}
