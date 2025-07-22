
"use client"

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type FormSubmission, type FormAnswer } from '@/types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download, File as FileIcon, Image as ImageIcon, Video as VideoIcon } from 'lucide-react';
import { Badge } from './ui/badge';
import { CheckCircle2, CircleDashed } from 'lucide-react';

interface ViewSubmissionModalProps {
  submission: FormSubmission | null;
  onOpenChange: (open: boolean) => void;
}

const formatAnswerValue = (value: FormAnswer['value']): React.ReactNode => {
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'url' in value[0]) {
        // It's an array of file attachments
        return (
          <div className="flex flex-wrap gap-2">
            {(value as { name: string; url: string; type: string }[]).map((file, index) => {
              let Icon = FileIcon;
              if (file.type.startsWith('image')) Icon = ImageIcon;
              if (file.type.startsWith('video')) Icon = VideoIcon;
              
              return (
                <a key={index} href={file.url} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm" className="h-auto py-1">
                    <Icon className="mr-2 h-4 w-4" />
                    {file.name}
                  </Button>
                </a>
              );
            })}
          </div>
        );
      }
      // It's an array of strings (e.g., from multiple-choice)
      return (value as string[]).join(', ');
    }
    return String(value);
};

const getAnswerValueForPdf = (value: FormAnswer['value']): string => {
    if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'url' in value[0]) {
            return (value as { name: string }[]).map(f => f.name).join(', ');
        }
        return (value as string[]).join(', ');
    }
    return String(value);
};

const AnswerRow: React.FC<{ answer: FormAnswer; level: number }> = ({ answer, level }) => {
    const hasSubAnswers = answer.subAnswers && answer.subAnswers.length > 0;
    const indentation = { paddingLeft: `${16 + level * 24}px` };

    return (
        <>
            <TableRow>
                <TableCell className="font-medium align-top" style={indentation}>
                    {level > 0 && <span className="mr-2 text-muted-foreground">↳</span>}
                    {answer.questionLabel}
                </TableCell>
                <TableCell>{formatAnswerValue(answer.value)}</TableCell>
            </TableRow>
            {hasSubAnswers && answer.subAnswers!.map(subAnswer => (
                <AnswerRow key={subAnswer.questionId} answer={subAnswer} level={level + 1} />
            ))}
        </>
    );
};


export function ViewSubmissionModal({ submission, onOpenChange }: ViewSubmissionModalProps) {
  if (!submission) return null;

  const buildPdfBody = (answers: FormAnswer[], level: number): string[][] => {
    let rows: string[][] = [];
    answers.forEach(answer => {
        const prefix = ' '.repeat(level * 2) + (level > 0 ? '↳ ' : '');
        rows.push([`${prefix}${answer.questionLabel}`, getAnswerValueForPdf(answer.value)]);
        if (answer.subAnswers && answer.subAnswers.length > 0) {
            rows = rows.concat(buildPdfBody(answer.subAnswers, level + 1));
        }
    });
    return rows;
  };

  const handleExportPdf = () => {
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text(submission.title, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Enviado por: ${submission.username}`, 14, 30);
    doc.text(`Quiosque: ${submission.kioskName}`, 14, 36);
    doc.text(`Data: ${format(new Date(submission.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, 14, 42);

    const head = [['Pergunta', 'Resposta']];
    const body = buildPdfBody(submission.answers, 0);

    autoTable(doc, {
      startY: 50,
      head: head,
      body: body,
      theme: 'grid',
      headStyles: { fillColor: '#3F51B5' },
    });

    doc.save(`resposta_${submission.title.replace(/\\/g, "").replace(/\//g, "").replace(/ /g,"_")}.pdf`);
  };
  
  const StatusBadge = () => {
    switch (submission.status) {
        case 'completed':
            return <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle2 className="mr-1 h-3 w-3" />Concluído</Badge>;
        case 'in_progress':
            return <Badge variant="outline" className="border-orange-500/50 text-orange-600"><CircleDashed className="mr-1 h-3 w-3 animate-spin" />Em Andamento</Badge>;
        default:
            return <Badge variant="secondary">Concluído</Badge>;
    }
  };

  return (
    <Dialog open={!!submission} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex justify-between items-center">
            <DialogTitle>{submission.title}</DialogTitle>
            <StatusBadge />
          </div>
          <DialogDescription>
            Enviado por {submission.username} em {submission.kioskName} em {format(new Date(submission.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[60vh] pr-6 -mx-4 px-4">
          <div className="rounded-md border my-4">
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>Pergunta</TableHead>
                          <TableHead>Resposta</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {submission.answers.length > 0 ? submission.answers.map((answer) => (
                          <AnswerRow key={answer.questionId} answer={answer} level={0} />
                      )) : (
                        <TableRow>
                            <TableCell colSpan={2} className="text-center text-muted-foreground">
                                Nenhuma resposta registrada para este envio.
                            </TableCell>
                        </TableRow>
                      )}
                  </TableBody>
              </Table>
          </div>
        </ScrollArea>
        <DialogFooter className="pt-4 border-t">
          <Button type="button" variant="outline" onClick={handleExportPdf}>
            <Download className="mr-2 h-4 w-4" /> Exportar para PDF
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
