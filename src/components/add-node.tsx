
"use client";

import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { PlusCircle } from 'lucide-react';
import { Button } from './ui/button';

interface AddNodeProps {
  data: {
    label: string;
    onAdd: () => void;
  };
}

export const AddNode = memo(({ data }: AddNodeProps) => {
  const { label, onAdd } = data;

  return (
    <div
      className="p-2 w-full"
    >
      <Button variant="outline" className="w-full h-12 border-dashed" onClick={onAdd}>
        <PlusCircle className="mr-2 h-4 w-4" />
        {label}
      </Button>
    </div>
  );
});

AddNode.displayName = 'AddNode';
