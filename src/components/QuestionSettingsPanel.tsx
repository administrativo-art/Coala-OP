
"use client";

import { type FormQuestion } from '@/types';
import { Button } from './ui/button';
import { X } from 'lucide-react';

interface QuestionSettingsPanelProps {
  question: FormQuestion;
  onChange: (updatedQuestion: FormQuestion) => void;
  onClose: () => void;
}

export function QuestionSettingsPanel({ question, onChange, onClose }: QuestionSettingsPanelProps) {

  return (
    <div className="w-[400px] h-full border-l bg-card flex flex-col shrink-0">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-semibold text-lg">Editar Pergunta</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <p>Configurações para: <strong>{question.label}</strong></p>
        <p className="mt-4 text-muted-foreground">Em breve, você poderá editar todos os detalhes da pergunta aqui, incluindo o tipo, as opções de resposta e as ramificações.</p>
      </div>

      <div className="p-4 border-t">
        <Button className="w-full" onClick={onClose}>Concluído</Button>
      </div>
    </div>
  );
}
