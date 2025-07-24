

"use client";

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ListChecks, Pin, PinOff, GripVertical, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { type FormQuestion } from '@/types';

interface QuestionNodeProps {
  data: FormQuestion & {
      onPinToggle: () => void;
      onDelete: () => void;
  };
  selected?: boolean;
}

export const QuestionNode = memo(({ data, selected }: QuestionNodeProps) => {
  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-16 !bg-primary" />
      <Card className={cn("w-[300px] shadow-md hover:shadow-lg transition-shadow duration-200 relative group", selected && "ring-2 ring-primary")}>
        <div className="drag-handle-question absolute top-1/2 -translate-y-1/2 -left-3 p-1 cursor-grab bg-background/50 rounded-md hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
        <CardHeader className="p-3 space-y-1">
          <div className="flex items-start justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{data.label}</span>
            </CardTitle>
            <div className="flex items-center">
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground" onClick={data.onPinToggle}>
                    {data.sectionId ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4"/>}
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive/70 hover:text-destructive" onClick={data.onDelete}>
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
