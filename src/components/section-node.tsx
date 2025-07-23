

"use client";

import React, { memo, useState, useEffect } from 'react';
import { Card, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useDebounce } from 'use-debounce';
import { cn } from '@/lib/utils';
import { type FormSection } from '@/types';
import { Palette, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { NodeResizer } from 'reactflow';


interface SectionNodeProps {
  data: {
    label: string;
    color?: string;
    onUpdate: (updates: Partial<Pick<FormSection, 'name' | 'color'>>) => void;
    onDelete: () => void;
  };
  selected: boolean;
}

const colorSwatches = [ '#F87171', '#FEF3C7', '#D1FAE5', '#DBEAFE', '#E0E7FF', '#F3E8FF', '#FCE7F3' ];

export const SectionNode = memo(({ data, selected }: SectionNodeProps) => {
  const [name, setName] = useState(data.label);
  const [debouncedName] = useDebounce(name, 500);

  useEffect(() => {
    if (debouncedName !== data.label) {
      data.onUpdate({ name: debouncedName });
    }
  }, [debouncedName, data.label, data.onUpdate]);

  return (
    <>
    <NodeResizer 
        isVisible={selected} 
        minWidth={200} 
        minHeight={200}
    />
    <Card 
        className={cn(
            "h-full w-full transition-colors border-2 bg-transparent",
            selected ? 'border-primary ring-2 ring-ring' : 'border-dashed'
        )}
        style={{ borderColor: data.color || 'hsl(var(--border))' }}
    >
      <CardHeader className="relative">
        <Input 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          className={cn(
            "text-lg font-semibold border-none bg-transparent focus-visible:ring-1 focus-visible:ring-ring p-1 h-auto w-auto inline-block",
            "text-foreground placeholder:text-muted-foreground"
          )}
        />
        <div className="absolute top-2 right-2 flex gap-1">
            <Button variant="ghost" size="icon" className={cn("h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive")} onClick={(e) => { e.stopPropagation(); data.onDelete(); }}>
                <Trash2 className="h-4 w-4"/>
            </Button>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className={cn("h-7 w-7 hover:bg-black/10 text-foreground/70 hover:text-foreground/100")}>
                        <Palette className="h-4 w-4"/>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2">
                    <div className="flex gap-1 items-center">
                        {colorSwatches.map(color => (
                             <Button key={color}
                                variant="outline"
                                className={cn("h-7 w-7 p-0 rounded-full", data.color === color && "border-2 border-primary ring-2 ring-ring")}
                                style={{ backgroundColor: color }}
                                onClick={() => data.onUpdate({ color })}
                             />
                        ))}
                        <Input
                            type="color"
                            value={data.color || '#000000'}
                            onChange={(e) => data.onUpdate({ color: e.target.value })}
                            className="w-10 h-8 p-1"
                        />
                        <Button
                            variant="outline"
                            className={cn("h-7 w-7 p-0 rounded-full", !data.color && "border-2 border-primary ring-2 ring-ring")}
                            onClick={() => data.onUpdate({ color: null as any })} // Send null to clear
                        />
                    </div>
                </PopoverContent>
            </Popover>
        </div>
      </CardHeader>
    </Card>
    </>
  );
});

SectionNode.displayName = 'SectionNode';
