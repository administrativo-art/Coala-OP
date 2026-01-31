
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
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const menuContent = (
    <div className="fixed bottom-8 right-8 z-50">
      <div className="relative flex flex-col items-center gap-3">
        
        <div className="flex flex-col-reverse items-center gap-3">
          <TooltipProvider>
            {items.map((item, index) => (
              <div
                key={index}
                className={cn(
                  "transition-all duration-300 ease-in-out",
                  isOpen
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 translate-y-4 pointer-events-none"
                )}
                style={{ transitionDelay: `${isOpen ? index * 40 : (items.length - index - 1) * 40}ms` }}
              >
                <Tooltip delayDuration={100}>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      className="rounded-full w-12 h-12 shadow-lg bg-background/80 backdrop-blur-md border border-white/20 hover:bg-muted"
                      onClick={() => {
                        item.onClick();
                        setIsOpen(false);
                      }}
                    >
                      {item.icon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>{item.label}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </TooltipProvider>
        </div>

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
