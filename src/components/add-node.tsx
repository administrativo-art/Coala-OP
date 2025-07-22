
"use client";

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { PlusCircle } from 'lucide-react';
import { Button } from './ui/button';

interface AddNodeProps {
  data: {
    label: string;
    type: 'section' | 'card';
    parentId?: string;
    onAdd: (type: 'section' | 'card', parentId?: string) => void;
  };
}

export const AddNode = memo(({ data }: AddNodeProps) => {
  const { label, type, parentId, onAdd } = data;
  const isSection = type === 'section';

  return (
    <div
      className="p-2 w-full"
      style={{
        width: isSection ? 'auto' : 'calc(100% - 40px)', // Full width inside parent
        minWidth: isSection ? 150 : 'auto',
      }}
    >
      <Button variant="outline" className="w-full h-12 border-dashed" onClick={() => onAdd(type, parentId)}>
        <PlusCircle className="mr-2 h-4 w-4" />
        {label}
      </Button>
    </div>
  );
});

AddNode.displayName = 'AddNode';
