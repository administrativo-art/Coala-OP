
"use client";

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Card, CardHeader, CardTitle, CardDescription } from './ui/card';
import { ListChecks } from 'lucide-react';

interface QuestionNodeProps {
  data: {
    label: string;
    description?: string;
  };
}

export const QuestionNode = memo(({ data }: QuestionNodeProps) => {
  return (
    <>
      <Handle type="target" position={Position.Left} className="w-2 h-2 !bg-primary" />
      <Card className="w-full shadow-md hover:shadow-lg transition-shadow duration-200">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
            {data.label}
          </CardTitle>
          {data.description && <CardDescription>{data.description}</CardDescription>}
        </CardHeader>
      </Card>
      <Handle type="source" position={Position.Right} className="w-2 h-2 !bg-primary" />
    </>
  );
});

QuestionNode.displayName = 'QuestionNode';
