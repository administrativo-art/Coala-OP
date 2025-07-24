

"use client";

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ListChecks, GripVertical, Trash2, FileText, ToggleRight, CircleDot, Paperclip, Type, CheckSquare, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { type FormQuestion } from '@/types';

interface QuestionNodeProps {
  id: string;
  data: FormQuestion & {
      onDelete: () => void;
  };
  selected?: boolean;
}

const QUESTION_VISUALS: { [key in FormQuestion['type']]: { icon: React.ElementType; color: string } } = {
  text: { icon: Type, color: 'border-blue-400/70 bg-blue-400/5' },
  number: { icon: MessageSquare, color: 'border-blue-400/70 bg-blue-400/5' },
  'yes-no': { icon: ToggleRight, color: 'border-green-400/70 bg-green-400/5' },
  'single-choice': { icon: CircleDot, color: 'border-green-400/70 bg-green-400/5' },
  'multiple-choice': { icon: CheckSquare, color: 'border-green-400/70 bg-green-400/5' },
  'file-attachment': { icon: Paperclip, color: 'border-yellow-400/70 bg-yellow-400/5' },
};


export const QuestionNode = memo(({ id, data, selected }: QuestionNodeProps) => {
  
  const handleDeleteClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    data.onDelete();
  };
  
  const visuals = QUESTION_VISUALS[data.type] || QUESTION_VISUALS.text;
  const Icon = visuals.icon;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-16 !bg-primary" />
      <Card className={cn(
          "w-[300px] shadow-md hover:shadow-lg transition-shadow duration-200 relative group border-2", 
          selected ? 'ring-2 ring-primary border-primary' : visuals.color
      )}>
        <div className="drag-handle-question absolute top-1/2 -translate-y-1/2 -left-3 p-1 cursor-grab bg-background/50 rounded-md hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
        <CardHeader className="p-3 space-y-1">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{data.label}</span>
            </CardTitle>
            <div className="flex items-center">
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive/70 hover:text-destructive" onClick={handleDeleteClick}>
                    <Trash2 className="h-4 w-4"/>
                </Button>
            </div>
          </div>
          {data.description && <CardDescription className="text-xs truncate">{data.description}</CardDescription>}
        </CardHeader>
      </Card>
      <Handle type="source" position={Position.Bottom} className="!w-16 !bg-primary" />
    </>
  );
});

QuestionNode.displayName = 'QuestionNode';
