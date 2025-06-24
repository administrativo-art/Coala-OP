"use client"

import { Github, Globe } from 'lucide-react';

export function AppFooter() {
  return (
    <footer className="w-full text-center py-6 px-4">
      <div className="flex justify-center items-center gap-6 text-muted-foreground">
        <a href="#" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary transition-colors">
          <Globe className="h-4 w-4" />
          <span>Coala Shakes</span>
        </a>
        <a href="#" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-primary transition-colors">
          <Github className="h-4 w-4" />
          <span>GitHub</span>
        </a>
      </div>
      <p className="text-xs text-muted-foreground/60 mt-4">
        Criado com ❤️ usando Firebase e Next.js
      </p>
    </footer>
  );
}
