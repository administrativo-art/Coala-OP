
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
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-primary" />
      <Card className={cn("w-full shadow-md hover:shadow-lg transition-shadow duration-200", selected && "ring-2 ring-primary")}>
        <CardHeader className="p-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{data.label}</span>
          </CardTitle>
          {data.description && <CardDescription className="truncate text-xs">{data.description}</CardDescription>}
        </CardHeader>
      </Card>
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-primary" />
    </>
  );
});

QuestionNode.displayName = 'QuestionNode';
