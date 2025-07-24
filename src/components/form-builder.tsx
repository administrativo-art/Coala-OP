

"use client";

import React from 'react';
import { type FormTemplate, type FormQuestion } from '@/types';
import { PlusCircle, GripVertical } from 'lucide-react';
import { Button } from './ui/button';
import { nanoid } from 'nanoid';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardHeader } from './ui/card';
import { cn } from '@/lib/utils';
import { ScrollArea } from './ui/scroll-area';

interface QuestionCardProps {
    question: FormQuestion;
    isSelected: boolean;
    onSelect: () => void;
}

const QuestionCard = React.memo(({ question, isSelected, onSelect }: QuestionCardProps) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: question.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} onClick={onSelect} className="w-full">
             <Card className={cn("w-full shadow-md hover:shadow-lg transition-shadow duration-200 group", isSelected && "ring-2 ring-primary")}>
                <CardHeader className="p-3 flex flex-row items-center gap-2">
                     <button {...attributes} {...listeners} className="cursor-grab p-1">
                        <GripVertical className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
                    </button>
                    <div className="flex-grow">
                        <p className="font-semibold">{question.label}</p>
                        {question.description && <p className="text-sm text-muted-foreground">{question.description}</p>}
                    </div>
                </CardHeader>
            </Card>
        </div>
    );
});
QuestionCard.displayName = 'QuestionCard';

interface SectionColumnProps {
    section: FormTemplate['sections'][0];
    onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>) => void;
    template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
    selectedQuestionId: string | null;
    onSelectQuestion: (id: string) => void;
    onAddQuestion: (sectionId: string) => void;
    isPublished: boolean;
}

const SectionColumn = React.memo(({ section, onTemplateChange, template, selectedQuestionId, onSelectQuestion, onAddQuestion, isPublished }: SectionColumnProps) => {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (active.id !== over?.id) {
            const oldIndex = section.questions.findIndex(q => q.id === active.id);
            const newIndex = section.questions.findIndex(q => q.id === over!.id);
            const newQuestions = arrayMove(section.questions, oldIndex, newIndex);

            const newSections = template.sections.map(s =>
                s.id === section.id ? { ...s, questions: newQuestions } : s
            );
            onTemplateChange({ ...template, sections: newSections });
        }
    };

    return (
        <Card className="w-[400px] h-full flex flex-col shrink-0 bg-muted/50">
            <CardHeader>
                <p className="font-semibold text-lg">{section.name}</p>
            </CardHeader>
            <ScrollArea className="flex-1">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={section.questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                        <div className="p-4 space-y-3">
                            {section.questions.map(question => (
                                <QuestionCard
                                    key={question.id}
                                    question={question}
                                    isSelected={selectedQuestionId === question.id}
                                    onSelect={() => onSelectQuestion(question.id)}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            </ScrollArea>
             {!isPublished && (
                <div className="p-4 border-t">
                    <Button variant="outline" className="w-full" onClick={() => onAddQuestion(section.id)}>
                        <PlusCircle className="mr-2" /> Adicionar Pergunta
                    </Button>
                </div>
            )}
        </Card>
    );
});
SectionColumn.displayName = 'SectionColumn';

interface FormBuilderProps {
  template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>) => void;
  onSelectQuestion: (questionId: string | null) => void;
  selectedQuestionId: string | null;
  onAddQuestion: (sectionId: string) => void;
  onAddSection: () => void;
  isPublished: boolean;
}

export function FormBuilder({ template, onTemplateChange, onSelectQuestion, selectedQuestionId, onAddQuestion, onAddSection, isPublished }: FormBuilderProps) {
  return (
    <div className="w-full h-full flex gap-4 p-4 overflow-x-auto bg-muted">
      {template.sections.map(section => (
        <SectionColumn
          key={section.id}
          section={section}
          template={template}
          onTemplateChange={onTemplateChange}
          selectedQuestionId={selectedQuestionId}
          onSelectQuestion={onSelectQuestion}
          onAddQuestion={onAddQuestion}
          isPublished={isPublished}
        />
      ))}
      {!isPublished && (
        <div className="shrink-0 w-[400px]">
            <Button variant="outline" className="w-full h-20 border-dashed" onClick={onAddSection}>
                <PlusCircle className="mr-2" /> Adicionar Momento / Seção
            </Button>
        </div>
      )}
    </div>
  );
}
