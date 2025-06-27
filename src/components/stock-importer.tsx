
"use client"

import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { BarChart3, UploadCloud, Settings, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function StockAnalyzer() {
    const { permissions } = useAuth();
    const { toast } = useToast();

    const handleUploadClick = () => {
        toast({
            title: "Funcionalidade em desenvolvimento",
            description: "A IA para ler PDFs ainda está sendo treinada pelo nosso coala chefe!",
        });
    };
    
    const handleConfigureClick = () => {
        toast({
            title: "Funcionalidade em desenvolvimento",
            description: "Este recurso para configurar parâmetros de análise estará disponível em breve.",
        });
    };

    const canUpload = permissions.stockAnalysis?.upload;
    const canConfigure = permissions.stockAnalysis?.configure;

    return (
        <Card className="w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95">
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <BarChart3 /> Análise de Estoque
                </CardTitle>
                <CardDescription>
                    Faça upload de relatórios para analisar o estoque atual, identificar faltas e otimizar as compras.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 p-6 text-center">
                 <p className="text-muted-foreground">
                    Use os botões abaixo para interagir com o módulo. Você pode subir um relatório de estoque para que nossa IA o analise, ou definir os parâmetros de estoque ideal para cada produto.
                </p>

                <div className="flex justify-center gap-4 pt-4">
                    <Button size="lg" onClick={handleUploadClick} disabled={!canUpload}>
                        <UploadCloud className="mr-2" /> Fazer Upload de Relatório
                    </Button>
                    <Button size="lg" variant="secondary" onClick={handleConfigureClick} disabled={!canConfigure}>
                        <Settings className="mr-2" /> Configurar Parâmetros
                    </Button>
                </div>
                
                {(!canUpload && !canConfigure) && (
                    <Alert variant="destructive" className="mt-8 text-left">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Acesso Negado</AlertTitle>
                        <AlertDescription>
                           Você não tem permissão para utilizar este módulo. Entre em contato com um administrador.
                        </AlertDescription>
                    </Alert>
                )}

            </CardContent>
        </Card>
    );
}
