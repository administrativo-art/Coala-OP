
"use client";

import React, { memo, useState, useEffect } from 'react';
import { Card, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useDebounce } from 'use-debounce';
import { cn } from '@/lib/utils';
import { type FormSection } from '@/types';
import { Trash2, GripVertical, Palette } from 'lucide-react';
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

const defaultColors = ['#FEE2E2', '#FEF3C7', '#D1FAE5', '#DBEAFE', '#E0E7FF', '#F3E8FF', '#FCE7F3'];


export const SectionNode = memo(({ id, data, selected }: SectionNodeProps) => {
  const [name, setName] = useState(data.label);
  const [color, setColor] = useState(data.color || defaultColors[0]);
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
    data.onUpdate({ color });
  }, [color, data.onUpdate]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, data, updateNodeInternals]);

  const handleColorChange = (newColor: string) => {
    setColor(newColor);
  };

  return (
    <>
    <NodeResizer 
        isVisible={selected} 
        minWidth={300} 
        minHeight={150}
    />
    <div
        className={cn(
            "h-full w-full rounded-lg transition-shadow duration-200 border-2",
            selected ? 'border-primary shadow-lg' : 'border-dashed'
        )}
        style={{
            backgroundColor: `${color}40`, // 25% opacity
            borderColor: color,
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
        <div className="absolute top-2 right-2 flex gap-1 items-center">
            <div className="flex items-center gap-1 bg-background/50 rounded-full px-1">
              {defaultColors.map(c => (
                <button
                  key={c}
                  onClick={() => handleColorChange(c)}
                  className={cn("h-4 w-4 rounded-full border transition-all", c === color ? "ring-2 ring-primary ring-offset-1" : "hover:scale-110")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
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
