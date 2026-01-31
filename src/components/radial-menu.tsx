"use client";

import { useState, ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { X, Wand2 } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface RadialMenuItem {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

interface RadialMenuProps {
  items: RadialMenuItem[];
}

export function RadialMenu({ items }: RadialMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const itemCount = items.length;
  // Spread items over a 120-degree arc instead of a full circle
  const arc = 120; 
  const angleStep = itemCount > 1 ? arc / (itemCount - 1) : 0;
  const radius = 90; // in pixels

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const menuContent = (
    <div className="fixed bottom-8 right-8 z-50">
      <div className="relative flex items-center justify-center">
        <TooltipProvider>
        {items.map((item, index) => {
          // Start angle at -150 degrees (bottom-left) and go up to -30 (bottom-right)
          const angle = -150 + (angleStep * index);
          const x = radius * Math.cos((angle * Math.PI) / 180);
          const y = radius * Math.sin((angle * Math.PI) / 180);

          return (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className={cn(
                    "absolute rounded-full w-12 h-12 shadow-lg transition-all duration-300 ease-in-out",
                    isOpen
                      ? "opacity-100"
                      : "opacity-0 scale-50 pointer-events-none"
                  )}
                  style={{
                    transform: isOpen ? `translate(${x}px, ${y}px)` : 'translate(0,0)',
                  }}
                  onClick={() => {
                    item.onClick();
                    setIsOpen(false);
                  }}
                >
                  {item.icon}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{item.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
        </TooltipProvider>

        <Button
          size="icon"
          className="relative w-16 h-16 rounded-full shadow-lg bg-primary hover:bg-primary/90"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Abrir menu de ações"
        >
          <Wand2 className={cn("h-7 w-7 transition-all duration-300", isOpen ? "transform rotate-45 scale-0 opacity-0" : "transform rotate-0 scale-100 opacity-100")} />
          <X className={cn("absolute h-7 w-7 transition-all duration-300", isOpen ? "transform rotate-0 scale-100 opacity-100" : "transform -rotate-45 scale-0 opacity-0")} />
        </Button>
      </div>
    </div>
  );

  if (isMounted && typeof document !== 'undefined') {
    return createPortal(menuContent, document.body);
  }

  return null;
}
