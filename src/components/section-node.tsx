

"use client";

import React, { memo, useState, useEffect } from 'react';
import { Card, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useDebounce } from 'use-debounce';
import { cn } from '@/lib/utils';
import { type FormSection } from '@/types';
import { Trash2, GripVertical } from 'lucide-react';
import { Button } from './ui/button';
import { NodeResizer, useUpdateNodeInternals } from 'reactflow';


interface SectionNodeProps {
  id: string;
  data: {
    label: string;
    color?: string;
    onUpdate: (updates: Partial<FormSection>) => void;
    onDelete: () => void;
  };
  selected: boolean;
}

export const SectionNode = memo(({ id, data, selected }: SectionNodeProps) => {
  const [name, setName] = useState(data.label);
  const [debouncedName] = useDebounce(name, 500);
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (debouncedName !== data.label) {
      data.onUpdate({ name: debouncedName });
    }
  }, [debouncedName, data.label, data.onUpdate]);
  
  useEffect(() => {
    setName(data.label);
  }, [data.label]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data, updateNodeInternals]);

  return (
    <>
    <NodeResizer 
        isVisible={selected} 
        minWidth={300} 
        minHeight={150}
    />
    <div
        className={cn(
            "h-full w-full rounded-lg transition-shadow duration-200 border-2 pointer-events-none",
            selected ? 'border-primary shadow-lg' : 'border-dashed'
        )}
        style={{
            backgroundColor: 'transparent',
            borderColor: data.color || 'hsl(var(--border))',
        }}
    >
      <div className="relative pointer-events-auto">
        <div className="drag-handle absolute top-2 left-2 p-1 cursor-grab bg-background/50 rounded-md hover:bg-muted">
            <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="absolute top-2 left-10 w-60">
            <Input 
            value={name} 
            onChange={(e) => setName(e.target.value)}
            className={cn(
                "text-lg font-semibold border-none bg-transparent focus-visible:ring-1 focus-visible:ring-ring p-1 h-auto",
            )}
            style={{color: 'hsl(var(--foreground))'}}
            />
        </div>
        <div className="absolute top-2 right-2 flex gap-1">
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive")} onClick={(e) => { e.stopPropagation(); data.onDelete(); }}>
                <Trash2 className="h-4 w-4"/>
            </Button>
        </div>
      </div>
    </div>
    </>
  );
});

SectionNode.displayName = 'SectionNode';
