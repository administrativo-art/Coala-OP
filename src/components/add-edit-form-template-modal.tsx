
"use client"

import React, { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { type FormTemplate, type FormQuestion as FormQuestionType, type FormSection } from '@/types';
import { Save } from 'lucide-react';
import { FormBuilder } from './form-builder';
import { QuestionSettingsPanel } from './QuestionSettingsPanel';
import { nanoid } from 'nanoid';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';

type AddEditFormTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateToEdit: FormTemplate | null;
  addTemplate: (template: Omit<FormTemplate, 'id'>) => void;
  updateTemplate: (template: FormTemplate) => void;
};

export function AddEditFormTemplateModal({ open, onOpenChange, templateToEdit, addTemplate, updateTemplate }: AddEditFormTemplateModalProps) {
  
  const [internalTemplate, setInternalTemplate] = useState<FormTemplate | Omit<FormTemplate, 'id'> | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const { users } = useAuth();
  const { profiles } = useProfiles();

  useEffect(() => {
    if (open) {
      if (templateToEdit) {
        setInternalTemplate(JSON.parse(JSON.stringify(templateToEdit)));
      } else {
        setInternalTemplate({
          name: 'Novo Formulário',
          type: 'standard',
          layout: 'continuous',
          moment: null,
          submissionTitleFormat: '',
          sections: [
            { id: `section-${nanoid()}`, name: 'Momento 1', questions: [], position: { x: 0, y: 0 } }
          ],
        });
      }
    } else {
      setInternalTemplate(null);
      setSelectedQuestionId(null);
    }
  }, [open, templateToEdit]);

  const handleTemplateChange = (newTemplate: FormTemplate | Omit<FormTemplate, 'id'>) => {
    setInternalTemplate(newTemplate);
  }

  const handleSave = () => {
    if (!internalTemplate) return;

    if ('id' in internalTemplate && internalTemplate.id) {
        updateTemplate(internalTemplate as FormTemplate);
    } else {
        addTemplate(internalTemplate as Omit<FormTemplate, 'id'>);
    }
    onOpenChange(false);
  };
  
  const selectedQuestion = useMemo(() => {
    if (!selectedQuestionId || !internalTemplate) return null;
    for (const section of internalTemplate.sections) {
        const question = section.questions.find(q => q.id === selectedQuestionId);
        if (question) return question;
    }
    return null;
  }, [selectedQuestionId, internalTemplate]);

  const handleQuestionChange = (updatedQuestion: FormQuestionType) => {
    if (!internalTemplate) return;

    const newSections = internalTemplate.sections.map(section => {
        const questionIndex = section.questions.findIndex(q => q.id === updatedQuestion.id);
        if (questionIndex > -1) {
            const newQuestions = [...section.questions];
            newQuestions[questionIndex] = updatedQuestion;
            return { ...section, questions: newQuestions };
        }
        return section;
    });

    handleTemplateChange({ ...internalTemplate, sections: newSections });
  };
  
  const allQuestions = useMemo(() => {
      if (!internalTemplate) return [];
      return internalTemplate.sections.flatMap(s => s.questions);
  }, [internalTemplate]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full h-[95vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>{templateToEdit ? 'Editar formulário' : 'Novo formulário'}</DialogTitle>
          <DialogDescription>
            Construa seu formulário ou processo usando o editor visual abaixo.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 min-h-0 flex">
            {internalTemplate && (
                 <FormBuilder 
                    key={('id' in internalTemplate) ? internalTemplate.id : 'new'}
                    initialTemplate={internalTemplate}
                    onTemplateChange={handleTemplateChange}
                    onNodeSelect={setSelectedQuestionId}
                    selectedNodeId={selectedQuestionId}
                />
            )}
            {selectedQuestion && (
                <QuestionSettingsPanel
                    key={selectedQuestion.id}
                    question={selectedQuestion}
                    allQuestions={allQuestions}
                    onChange={handleQuestionChange}
                    onClose={() => setSelectedQuestionId(null)}
                    users={users}
                    profiles={profiles}
                />
            )}
        </div>
        
        <DialogFooter className="p-4 border-t shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave}><Save className="mr-2 h-4 w-4" /> Salvar Modelo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
