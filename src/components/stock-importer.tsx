
"use client"

import { useState, useRef, ChangeEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { UploadCloud, FileText, X, Loader2, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type ExtractedItem = {
    productName: string;
    quantity: number;
    status: 'found' | 'not_found' | 'ambiguous';
    match?: string; // Full name of the matched product
};

export function StockImporter() {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [extractedData, setExtractedData] = useState<ExtractedItem[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { toast } = useToast();

    const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            if (selectedFile.type !== 'application/pdf') {
                setError('Por favor, selecione um arquivo PDF.');
                setFile(null);
                return;
            }
            if (selectedFile.size > 5 * 1024 * 1024) { // 5MB limit
                setError('O arquivo é muito grande. O limite é de 5MB.');
                setFile(null);
                return;
            }
            setFile(selectedFile);
            setError(null);
            setExtractedData([]);
        }
    };

    const handleProcessFile = async () => {
        if (!file) return;

        setIsProcessing(true);
        setError(null);
        setProgress(10);

        // Here we would call the Genkit flow to process the PDF
        // For now, we simulate the process
        setTimeout(() => setProgress(30), 500);
        setTimeout(() => setProgress(60), 1500);

        // Simulate a delay and mock response
        setTimeout(() => {
            const mockData: ExtractedItem[] = [
                { productName: 'Leite Integral', quantity: 20, status: 'found', match: 'Leite Integral (1L)' },
                { productName: 'Choc. em Pó', quantity: 15, status: 'found', match: 'Chocolate em Pó (400g)' },
                { productName: 'Açúcar Ref.', quantity: 10, status: 'not_found' },
                { productName: 'Polpa de Fruta', quantity: 5, status: 'ambiguous' },
            ];
            setExtractedData(mockData);
            setProgress(100);
            setIsProcessing(false);
            toast({
                title: "Processamento concluído",
                description: "Revise os itens extraídos do PDF antes de confirmar.",
            });
        }, 3000);
    };

    const handleConfirmImport = () => {
        // Here we would update the stock in Firestore
        console.log("Importing data:", extractedData);
        toast({
            title: "Estoque atualizado!",
            description: "Os itens foram adicionados ao controle de validade.",
        });
        setFile(null);
        setExtractedData([]);
        setProgress(0);
    };
    
    const getStatusBadge = (status: ExtractedItem['status']) => {
        switch(status) {
            case 'found': return <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle className="mr-1 h-3 w-3" />Encontrado</Badge>;
            case 'not_found': return <Badge variant="destructive"><X className="mr-1 h-3 w-3" />Não encontrado</Badge>;
            case 'ambiguous': return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800"><AlertCircle className="mr-1 h-3 w-3" />Ambíguo</Badge>;
        }
    }

    return (
        <Card className="w-full max-w-4xl mx-auto animate-in fade-in zoom-in-95">
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <Sparkles /> Importador de Estoque Inteligente
                </CardTitle>
                <CardDescription>Faça o upload de uma nota fiscal ou relatório em PDF para atualizar o estoque.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 p-6">
                {!file && (
                    <div
                        className="flex flex-col items-center justify-center w-full p-10 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <UploadCloud className="w-12 h-12 text-muted-foreground" />
                        <p className="mt-4 text-lg font-semibold">Clique ou arraste um arquivo PDF aqui</p>
                        <p className="text-sm text-muted-foreground">O tamanho máximo do arquivo é 5MB</p>
                        <Input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            accept="application/pdf"
                            onChange={handleFileSelect}
                        />
                    </div>
                )}
                
                {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Erro</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                
                {file && (
                    <div className="p-4 border rounded-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <FileText className="h-8 w-8 text-primary" />
                                <div>
                                    <p className="font-medium">{file.name}</p>
                                    <p className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(2)} KB</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => { setFile(null); setExtractedData([]); setError(null); }}>
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        {isProcessing && (
                            <div className="mt-4">
                                <Progress value={progress} className="w-full" />
                                <p className="text-sm text-center mt-2 text-muted-foreground">A IA está lendo seu arquivo... isso pode levar um momento.</p>
                            </div>
                        )}
                    </div>
                )}

                {extractedData.length > 0 && (
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold">Itens Extraídos para Revisão</h3>
                        <div className="border rounded-lg overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Produto no PDF</TableHead>
                                        <TableHead>Produto no Sistema</TableHead>
                                        <TableHead className="text-right">Quantidade</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {extractedData.map((item, index) => (
                                        <TableRow key={index}>
                                            <TableCell className="font-medium">{item.productName}</TableCell>
                                            <TableCell>{item.match || '---'}</TableCell>
                                            <TableCell className="text-right">{item.quantity}</TableCell>
                                            <TableCell>{getStatusBadge(item.status)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Atenção!</AlertTitle>
                            <AlertDescription>
                                Itens marcados como "Não encontrado" ou "Ambíguo" não serão importados. Por favor, cadastre-os manualmente ou ajuste os nomes no sistema antes de uma nova importação.
                            </AlertDescription>
                        </Alert>
                    </div>
                )}

                <div className="flex justify-end gap-4">
                    <Button 
                        onClick={handleProcessFile} 
                        disabled={!file || isProcessing || extractedData.length > 0}
                    >
                        {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Processar Arquivo
                    </Button>
                    {extractedData.length > 0 && (
                        <Button onClick={handleConfirmImport} disabled={isProcessing}>
                            Confirmar e Adicionar ao Estoque
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
