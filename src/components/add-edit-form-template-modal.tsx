

"use client"

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { Save, Settings, Cloud, CheckCircle2, FileUp, Undo2, PlusCircle } from 'lucide-react';
import { FormBuilder } from './form-builder';
import { QuestionSettingsPanel } from './QuestionSettingsPanel';
import { nanoid } from 'nanoid';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { FormGeneralSettings } from './form-general-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from '@/hooks/use-toast';
import { Badge } from './ui/badge';


type AddEditFormTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateToEdit: FormTemplate | null;
  addTemplate: (template: Omit<FormTemplate, 'id' | 'status'>) => Promise<string | null>;
  updateTemplate: (template: FormTemplate) => void;
};

export function AddEditFormTemplateModal({ open, onOpenChange, templateToEdit, addTemplate, updateTemplate }: AddEditFormTemplateModalProps) {
  
  const [internalTemplate, setInternalTemplate] = useState<FormTemplate | Omit<FormTemplate, 'id' | 'status'> | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const { users } = useAuth();
  const { profiles } = useProfiles();
  const [activeTab, setActiveTab] = useState("builder");
  const [isSaving, setIsSaving] = useState<'auto' | 'manual' | false>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const { toast } = useToast();
  
  const autoSaveTimer = useRef<NodeJS.Timeout | null>(null);

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
            { id: `section-${nanoid()}`, name: 'Seção 1', questions: [] }
          ],
        });
      }
       setActiveTab("builder");
       setHasUnsavedChanges(false);
    } else {
      setInternalTemplate(null);
      setSelectedQuestionId(null);
      if (autoSaveTimer.current) {
          clearTimeout(autoSaveTimer.current);
      }
    }
  }, [open, templateToEdit]);

  const handleTemplateChange = useCallback((newTemplate: FormTemplate | Omit<FormTemplate, 'id' | 'status'>) => {
    setInternalTemplate(newTemplate);
    setHasUnsavedChanges(true);
  }, []);
  
  const autoSave = async (showToast = false) => {
    if (!internalTemplate || !('id' in internalTemplate)) return;
    
    setIsSaving('auto');
    await updateTemplate(internalTemplate as FormTemplate);
    if(showToast) {
        toast({ title: 'Rascunho salvo!', description: 'Suas alterações foram salvas com sucesso.' });
    }
    setIsSaving(false);
    setHasUnsavedChanges(false);
  }
  
  const handlePublish = async () => {
     if (!internalTemplate || !('id' in internalTemplate)) return;
     
     await autoSave(false);
     await updateTemplate({ ...internalTemplate as FormTemplate, status: 'published' });
     toast({ title: 'Formulário publicado!', description: 'Seu formulário agora está disponível para os usuários.' });
     onOpenChange(false);
  }

  const handleReopen = async () => {
    if (!internalTemplate || !('id' in internalTemplate)) return;
    await updateTemplate({ ...internalTemplate as FormTemplate, status: 'draft' });
    toast({ title: 'Formulário reaberto!', description: 'Agora você pode editar o formulário novamente.' });
  }

  useEffect(() => {
    if(hasUnsavedChanges && internalTemplate && 'id' in internalTemplate) {
        if(autoSaveTimer.current) {
            clearTimeout(autoSaveTimer.current);
        }
        autoSaveTimer.current = setTimeout(async () => {
            setIsSaving('auto');
            await updateTemplate(internalTemplate as FormTemplate);
            setIsSaving(false);
            setHasUnsavedChanges(false);
        }, 5000); // Autosave after 5 seconds of inactivity
    }
    return () => {
        if (autoSaveTimer.current) {
            clearTimeout(autoSaveTimer.current);
        }
    }
  }, [internalTemplate, hasUnsavedChanges, updateTemplate]);

  const handleAddQuestion = (sectionId: string) => {
    if (!internalTemplate) return;

    const newQuestion: FormQuestion = {
      id: `question-${nanoid()}`,
      label: 'Nova Pergunta',
      type: 'text',
      isRequired: false,
    };

    const newSections = internalTemplate.sections.map(section => {
      if (section.id === sectionId) {
        return { ...section, questions: [...section.questions, newQuestion] };
      }
      return section;
    });
    
    handleTemplateChange({ ...internalTemplate, sections: newSections });
    setSelectedQuestionId(newQuestion.id);
  };
  
  const handleAddSection = () => {
    if (!internalTemplate) return;
    const newSection: FormSection = {
      id: `section-${nanoid()}`,
      name: `Seção ${internalTemplate.sections.length + 1}`,
      questions: [],
    };
    handleTemplateChange({ ...internalTemplate, sections: [...internalTemplate.sections, newSection] });
  };
  
  const selectedQuestion = useMemo(() => {
    if (!selectedQuestionId || !internalTemplate || !internalTemplate.sections) return null;
    for (const section of internalTemplate.sections) {
        const question = section.questions.find(q => q.id === selectedQuestionId);
        if (question) return question;
    }
    return null;
  }, [selectedQuestionId, internalTemplate]);

  const handleQuestionChange = (updatedQuestion: FormQuestion) => {
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
    if (!internalTemplate || !internalTemplate.sections) return [];
    return internalTemplate.sections.flatMap(s => s.questions || []);
  }, [internalTemplate]);

  const isPublished = internalTemplate && 'id' in internalTemplate && internalTemplate.status === 'published';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full h-[95vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b flex flex-row items-center justify-between">
          <div>
            <DialogTitle>{templateToEdit ? 'Editar formulário' : 'Novo formulário'}</DialogTitle>
            <DialogDescription>
                Use as abas abaixo para configurar o formulário e construir o fluxo de perguntas.
            </DialogDescription>
          </div>
           <div className="flex items-center gap-2">
                {isSaving === 'auto' && <span className="text-sm text-muted-foreground flex items-center gap-1"><Cloud className="h-4 w-4 animate-pulse"/>Salvando...</span>}
                {isSaving === false && !hasUnsavedChanges && internalTemplate && 'id' in internalTemplate && <span className="text-sm text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-4 w-4 text-green-600"/>Salvo</span>}
           </div>
        </DialogHeader>
        
         <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
            <div className="p-4 border-b">
                <TabsList>
                    <TabsTrigger value="builder">Builder Visual</TabsTrigger>
                    <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4"/> Configurações Gerais</TabsTrigger>
                </TabsList>
            </div>
            <TabsContent value="builder" className="flex-1 min-h-0">
                <div className="flex-1 min-h-0 flex h-full">
                    {internalTemplate && (
                        <FormBuilder 
                            key={('id' in internalTemplate) ? internalTemplate.id : 'new'}
                            template={internalTemplate}
                            onTemplateChange={handleTemplateChange}
                            onSelectQuestion={setSelectedQuestionId}
                            onAddQuestion={handleAddQuestion}
                            onAddSection={handleAddSection}
                            selectedQuestionId={selectedQuestionId}
                            isPublished={isPublished}
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
            </TabsContent>
            <TabsContent value="settings" className="flex-1 overflow-auto p-6">
                 {internalTemplate && (
                    <FormGeneralSettings 
                        template={internalTemplate} 
                        onTemplateChange={handleTemplateChange}
                    />
                 )}
            </TabsContent>
        </Tabs>
        
        <DialogFooter className="p-4 border-t shrink-0">
          <div className="w-full flex justify-between items-center">
             <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
            </div>
            
            <div className="flex items-center gap-2">
                {isPublished ? (
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="bg-green-100 text-green-800">Publicado</Badge>
                        <Button onClick={handleReopen} variant="outline">
                            <Undo2 className="mr-2 h-4 w-4"/> Reabrir para Edição
                        </Button>
                    </div>
                ) : (
                    <>
                        <Button onClick={handlePublish} disabled={isSaving !== false || hasUnsavedChanges}>
                            <FileUp className="mr-2 h-4 w-4" />
                            {hasUnsavedChanges ? 'Salvando para publicar...' : 'Publicar'}
                        </Button>
                    </>
                )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
