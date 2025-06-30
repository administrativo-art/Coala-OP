"use client"

import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { type FormSubmission } from '@/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, FileClock, Eye } from 'lucide-react';
import { DeleteConfirmationDialog } from './delete-confirmation-dialog';
import { ViewSubmissionModal } from './view-submission-modal';

interface FormSubmissionsHistoryProps {
    submissions: FormSubmission[];
    loading: boolean;
    deleteSubmission: (id: string) => void;
    canDelete: boolean;
}

export function FormSubmissionsHistory({ submissions, loading, deleteSubmission, canDelete }: FormSubmissionsHistoryProps) {
    const [submissionToDelete, setSubmissionToDelete] = useState<FormSubmission | null>(null);
    const [submissionToView, setSubmissionToView] = useState<FormSubmission | null>(null);

    const handleDeleteClick = (submission: FormSubmission) => {
        setSubmissionToDelete(submission);
    };

    const handleViewClick = (submission: FormSubmission) => {
        setSubmissionToView(submission);
    }

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

    return (
        <>
            <div className="w-full space-y-3 mt-4">
                {submissions.map(submission => (
                    <div key={submission.id} className="border rounded-lg p-4 flex items-center justify-between gap-4 w-full hover:bg-muted/50 transition-colors">
                        <div className="grid gap-1 text-left flex-grow cursor-pointer" onClick={() => handleViewClick(submission)}>
                            <p className="font-semibold">{submission.title || submission.templateName}</p>
                            <p className="text-sm text-muted-foreground">
                                Enviado por <strong>{submission.username}</strong> em {submission.kioskName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {format(new Date(submission.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                             <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => handleViewClick(submission)}
                            >
                                <Eye className="mr-2 h-4 w-4" />
                                Visualizar
                            </Button>
                            {canDelete && (
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteClick(submission)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <ViewSubmissionModal 
                submission={submissionToView}
                onOpenChange={() => setSubmissionToView(null)}
            />
            
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
