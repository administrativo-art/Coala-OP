
"use client";

import React, { createContext, useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { useRouter } from 'next/navigation';

const SIDEBAR_LAST_VISITED_KEY = 'coala-sidebar-last-visited';

interface SidebarContextType {
  lastVisited: string | null;
  setLastVisited: (path: string) => void;
  prefetch: (path: string) => void;
  clearPrefetch: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [lastVisited, setLastVisitedState] = useState<string | null>(null);
  const router = useRouter();
  const prefetchTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // On initial load, try to get the last visited path from localStorage
    const storedPath = localStorage.getItem(SIDEBAR_LAST_VISITED_KEY);
    if (storedPath) {
      setLastVisitedState(storedPath);
    }

    // After a short delay, clear the "last visited" state so the animation doesn't repeat on every navigation
    const timeout = setTimeout(() => {
        setLastVisitedState(null);
    }, 1500); // Animation is 1s, give it some buffer

    return () => clearTimeout(timeout);
  }, []);

  const setLastVisited = useCallback((path: string) => {
    localStorage.setItem(SIDEBAR_LAST_VISITED_KEY, path);
    // No need to update state here, as it's mainly for the initial load animation
  }, []);
  
  const prefetch = useCallback((path: string) => {
      clearPrefetch();
      prefetchTimer.current = setTimeout(() => {
          router.prefetch(path);
      }, 200); // Prefetch after 200ms of hovering
  }, [router]);
  
  const clearPrefetch = useCallback(() => {
      if (prefetchTimer.current) {
          clearTimeout(prefetchTimer.current);
          prefetchTimer.current = null;
      }
  }, []);

  const value = useMemo(() => ({
    lastVisited,
    setLastVisited,
    prefetch,
    clearPrefetch,
  }), [lastVisited, setLastVisited, prefetch, clearPrefetch]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export const useSidebar = (): SidebarContextType => {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};
