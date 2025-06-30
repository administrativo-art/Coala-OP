
"use client"

import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { type FormSubmission } from '@/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, Trash2, FileClock } from 'lucide-react';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';

interface FormSubmissionsHistoryProps {
    submissions: FormSubmission[];
    loading: boolean;
    deleteSubmission: (id: string) => void;
    canDelete: boolean;
}

export function FormSubmissionsHistory({ submissions, loading, deleteSubmission, canDelete }: FormSubmissionsHistoryProps) {
    const [submissionToDelete, setSubmissionToDelete] = useState<FormSubmission | null>(null);

    const handleDeleteClick = (submission: FormSubmission) => {
        setSubmissionToDelete(submission);
    };

    const handleDeleteConfirm = () => {
        if (submissionToDelete) {
            deleteSubmission(submissionToDelete.id);
            setSubmissionToDelete(null);
        }
    };

    if (loading) {
        return (
            <div className="space-y-3 pt-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        )
    }

    if (submissions.length === 0) {
        return (
             <div className="text-center py-12 px-6 border-2 border-dashed rounded-lg text-muted-foreground mt-6">
                <FileClock className="mx-auto h-12 w-12" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Nenhum formulário respondido</h3>
                <p className="mt-1 text-sm">O histórico de respostas aparecerá aqui assim que um formulário for preenchido.</p>
            </div>
        )
    }

    const formatAnswerValue = (value: string | number | string[]): string => {
        if (Array.isArray(value)) {
            return value.join(', ');
        }
        return String(value);
    }
    
    return (
        <>
            <Accordion type="multiple" className="w-full space-y-3 mt-4">
                {submissions.map(submission => (
                    <AccordionItem value={submission.id} key={submission.id} className="border rounded-lg">
                        <AccordionTrigger className="p-4 hover:no-underline w-full">
                            <div className="flex items-center justify-between gap-4 w-full">
                                <div className="grid gap-1 text-left">
                                    <p className="font-semibold">{submission.title || submission.templateName}</p>
                                    <p className="text-sm text-muted-foreground">
                                        Enviado por <strong>{submission.username}</strong> em {submission.kioskName}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {format(new Date(submission.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                    </p>
                                </div>
                                {canDelete && (
                                     <Button 
                                        asChild 
                                        variant="ghost" 
                                        size="icon" 
                                        className="text-destructive hover:text-destructive shrink-0"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteClick(submission); }}
                                    >
                                        <span><Trash2 className="h-4 w-4" /></span>
                                    </Button>
                                )}
                            </div>
                        </AccordionTrigger>
                        <AccordionContent className="p-4 pt-0">
                            <div className="rounded-md border mt-2">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Pergunta</TableHead>
                                            <TableHead>Resposta</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {submission.answers.map((answer) => (
                                            <TableRow key={answer.questionId}>
                                                <TableCell>{answer.questionLabel}</TableCell>
                                                <TableCell className="font-medium">{formatAnswerValue(answer.value)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
             {submissionToDelete && (
                <DeleteConfirmationDialog
                    open={!!submissionToDelete}
                    onOpenChange={() => setSubmissionToDelete(null)}
                    onConfirm={handleDeleteConfirm}
                    itemName={`a resposta do formulário "${submissionToDelete.title || submissionToDelete.templateName}" enviado por ${submissionToDelete.username}`}
                />
            )}
        </>
    );
}
