
"use client";

import React, { memo, useState, useEffect } from 'react';
import { Card, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useDebounce } from 'use-debounce';
import { cn } from '@/lib/utils';
import { type FormSection } from '@/types';
import { Palette } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';

interface SectionNodeProps {
  data: {
    label: string;
    color?: string;
    onUpdate: (updates: Partial<Pick<FormSection, 'name' | 'color'>>) => void;
  };
}

const colorSwatches = [ '#FEE2E2', '#FEF3C7', '#D1FAE5', '#DBEAFE', '#E0E7FF', '#F3E8FF', '#FCE7F3' ];

export const SectionNode = memo(({ data }: SectionNodeProps) => {
  const [name, setName] = useState(data.label);
  const [debouncedName] = useDebounce(name, 500);

  useEffect(() => {
    if (debouncedName !== data.label) {
      data.onUpdate({ name: debouncedName });
    }
  }, [debouncedName, data.label, data.onUpdate]);

  return (
    <Card 
        className={cn("border-dashed h-full transition-colors")}
        style={{ backgroundColor: data.color || 'hsl(var(--muted))' }}
    >
      <CardHeader className="relative">
        <Input 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          className="text-lg font-semibold border-none bg-transparent focus-visible:ring-1 focus-visible:ring-ring p-1 h-auto"
        />
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-foreground">
                    <Palette className="h-4 w-4"/>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
                <div className="flex gap-1">
                    {colorSwatches.map(color => (
                         <Button key={color}
                            variant="outline"
                            className={cn("h-7 w-7 p-0 rounded-full", data.color === color && "border-2 border-primary")}
                            style={{ backgroundColor: color }}
                            onClick={() => data.onUpdate({ color })}
                         />
                    ))}
                    <Button
                        variant="outline"
                        className={cn("h-7 w-7 p-0 rounded-full", !data.color && "border-2 border-primary")}
                        onClick={() => data.onUpdate({ color: undefined })}
                    />
                </div>
            </PopoverContent>
        </Popover>
      </CardHeader>
    </Card>
  );
});

SectionNode.displayName = 'SectionNode';
