

"use client";

import React, { memo, useState, useEffect } from 'react';
import { Card, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useDebounce } from 'use-debounce';
import { cn } from '@/lib/utils';
import { type FormSection } from '@/types';
import { Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { NodeResizer } from 'reactflow';


interface SectionNodeProps {
  data: {
    label: string;
    color?: string;
    onUpdate: (updates: Partial<Pick<FormSection, 'name'>>) => void;
    onDelete: () => void;
  };
  selected: boolean;
}

export const SectionNode = memo(({ data, selected }: SectionNodeProps) => {
  const [name, setName] = useState(data.label);
  const [debouncedName] = useDebounce(name, 500);

  useEffect(() => {
    if (debouncedName !== data.label) {
      data.onUpdate({ name: debouncedName });
    }
  }, [debouncedName, data.label, data.onUpdate]);
  
  useEffect(() => {
    setName(data.label);
  }, [data.label]);


  return (
    <>
    <NodeResizer 
        isVisible={selected} 
        minWidth={300} 
        minHeight={150}
    />
    <Card 
        className={cn(
            "h-full w-full transition-shadow duration-200 border-2",
            selected ? 'border-primary shadow-lg' : 'border-dashed'
        )}
    >
      <CardHeader className="relative">
        <Input 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          className={cn(
            "text-lg font-semibold border-none bg-transparent focus-visible:ring-1 focus-visible:ring-ring p-1 h-auto",
          )}
          style={{color: 'hsl(var(--foreground))'}}
        />
        <div className="absolute top-2 right-2 flex gap-1">
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive")} onClick={(e) => { e.stopPropagation(); data.onDelete(); }}>
                <Trash2 className="h-4 w-4"/>
            </Button>
        </div>
      </CardHeader>
    </Card>
    </>
  );
});

SectionNode.displayName = 'SectionNode';
