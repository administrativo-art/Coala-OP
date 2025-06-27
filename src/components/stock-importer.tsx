
"use client"

import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { BarChart3, UploadCloud, Settings, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { StockAnalysisConfigurator } from './stock-analysis-configurator';

export function StockAnalyzer() {
    const { permissions } = useAuth();
    const { toast } = useToast();

    const handleUploadClick = () => {
        toast({
            title: "Funcionalidade em desenvolvimento",
            description: "A IA para ler PDFs ainda está sendo treinada pelo nosso coala chefe!",
        });
    };

    const canUpload = permissions.stockAnalysis?.upload;
    const canConfigure = permissions.stockAnalysis?.configure;

    if (!canUpload && !canConfigure) {
      return (
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader>
              <CardTitle className="font-headline flex items-center gap-2"><BarChart3 /> Análise de Estoque</CardTitle>
              <CardDescription>Faça upload de relatórios para analisar o estoque atual, identificar faltas e otimizar as compras.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive" className="mt-8 text-left">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Acesso Negado</AlertTitle>
                <AlertDescription>
                    Você não tem permissão para utilizar este módulo. Entre em contato com um administrador.
                </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      );
    }

    const defaultTab = canUpload ? "analysis" : "parameters";

    return (
        <Tabs defaultValue={defaultTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                {canUpload && <TabsTrigger value="analysis"><UploadCloud className="mr-2" /> Analisar Relatório</TabsTrigger>}
                {canConfigure && <TabsTrigger value="parameters"><Settings className="mr-2" /> Configurar Parâmetros</TabsTrigger>}
            </TabsList>
            {canUpload && (
              <TabsContent value="analysis" className="mt-4">
                  <Card>
                      <CardHeader>
                          <CardTitle>Analisar Relatório de Estoque</CardTitle>
                          <CardDescription>Faça upload de um arquivo PDF para que a nossa IA identifique os itens, compare com o estoque ideal e sugira as compras.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4 text-center p-6">
                          <p className="text-muted-foreground text-sm max-w-md mx-auto">Esta funcionalidade está em desenvolvimento. Em breve você poderá automatizar sua análise de estoque com um simples upload.</p>
                          <Button size="lg" onClick={handleUploadClick} className="mt-4">
                              <UploadCloud className="mr-2" /> Fazer Upload de Relatório
                          </Button>
                      </CardContent>
                  </Card>
              </TabsContent>
            )}
            {canConfigure && (
              <TabsContent value="parameters" className="mt-4">
                  <Card>
                       <CardHeader>
                          <CardTitle>Configurar Parâmetros de Análise</CardTitle>
                          <CardDescription>Defina o estoque ideal por quiosque e as unidades de compra para cada produto. Essas informações são essenciais para a análise automática.</CardDescription>
                      </CardHeader>
                      <CardContent className="p-6">
                          <StockAnalysisConfigurator />
                      </CardContent>
                  </Card>
              </TabsContent>
            )}
        </Tabs>
    );
}
