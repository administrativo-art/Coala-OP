

"use client";

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuestionNodeProps {
  data: {
    label: string;
    description?: string;
  };
  selected?: boolean;
}

export const QuestionNode = memo(({ data, selected }: QuestionNodeProps) => {
  return (
    <>
      <Card className={cn("w-full shadow-md hover:shadow-lg transition-shadow duration-200", selected && "ring-2 ring-primary")}>
        <CardHeader className="p-3 space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{data.label}</span>
          </CardTitle>
          {data.description && <CardDescription className="text-xs truncate">{data.description}</CardDescription>}
        </CardHeader>
      </Card>
    </>
  );
});

QuestionNode.displayName = 'QuestionNode';
