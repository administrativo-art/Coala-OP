
"use client";

import React, { memo, useState, useEffect } from 'react';
import { Card, CardHeader } from './ui/card';
import { Input } from './ui/input';
import { useDebounce } from 'use-debounce';

interface SectionNodeProps {
  data: {
    label: string;
    onNameChange: (newName: string) => void;
  };
}

export const SectionNode = memo(({ data }: SectionNodeProps) => {
  const [name, setName] = useState(data.label);
  const [debouncedName] = useDebounce(name, 500);

  useEffect(() => {
    // Prevent calling onNameChange on initial render if name hasn't changed
    if (debouncedName !== data.label) {
      data.onNameChange(debouncedName);
    }
  }, [debouncedName, data.onNameChange, data.label]);

  return (
    <Card className="bg-muted/30 border-dashed h-full">
      <CardHeader>
        <Input 
          value={name} 
          onChange={(e) => setName(e.target.value)}
          className="text-lg font-semibold border-none bg-transparent focus-visible:ring-1 focus-visible:ring-ring p-1 h-auto"
        />
      </CardHeader>
    </Card>
  );
});

SectionNode.displayName = 'SectionNode';
