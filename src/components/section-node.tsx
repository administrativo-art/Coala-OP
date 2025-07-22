
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

// A simple function to determine if a color is light or dark
// Returns true for light colors, false for dark
const isColorLight = (color: string): boolean => {
    // Basic implementation: check brightness
    // This can be improved with a more sophisticated algorithm (e.g., calculating luminance)
    try {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return brightness > 155;
    } catch(e) {
        return true; // Default to light if color is invalid
    }
};

export const SectionNode = memo(({ data }: SectionNodeProps) => {
  const [name, setName] = useState(data.label);
  const [debouncedName] = useDebounce(name, 500);

  useEffect(() => {
    if (debouncedName !== data.label) {
      data.onUpdate({ name: debouncedName });
    }
  }, [debouncedName, data.label, data.onUpdate]);

  const textColorClass = data.color && !isColorLight(data.color) ? 'text-white/90 placeholder:text-white/60' : 'text-foreground';

  return (
    <Card 
        className={cn("border-dashed h-full transition-colors")}
        style={{ backgroundColor: data.color || 'hsl(var(--muted))' }}
    >
      <CardHeader className="relative">
        <Input 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          className={cn(
            "text-lg font-semibold border-none bg-transparent focus-visible:ring-1 focus-visible:ring-ring p-1 h-auto",
            textColorClass
          )}
        />
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className={cn("absolute top-2 right-2 h-7 w-7 hover:bg-black/10", textColorClass)}>
                    <Palette className="h-4 w-4"/>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2">
                <div className="flex gap-1">
                    {colorSwatches.map(color => (
                         <Button key={color}
                            variant="outline"
                            className={cn("h-7 w-7 p-0 rounded-full", data.color === color && "border-2 border-primary ring-2 ring-ring")}
                            style={{ backgroundColor: color }}
                            onClick={() => data.onUpdate({ color })}
                         />
                    ))}
                    <Button
                        variant="outline"
                        className={cn("h-7 w-7 p-0 rounded-full", !data.color && "border-2 border-primary ring-2 ring-ring")}
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
