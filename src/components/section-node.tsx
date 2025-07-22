
"use client";

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Card, CardHeader, CardTitle } from './ui/card';

interface SectionNodeProps {
  data: {
    label: string;
  };
}

export const SectionNode = memo(({ data }: SectionNodeProps) => {
  return (
    <Card className="bg-muted/30 border-dashed h-full">
      <CardHeader>
        <CardTitle className="text-lg text-muted-foreground">{data.label}</CardTitle>
      </CardHeader>
    </Card>
  );
});

SectionNode.displayName = 'SectionNode';
