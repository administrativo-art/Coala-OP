"use client";

import { useContext } from "react";
import { RepositionContext } from "@/components/reposition-provider";
import { type RepositionContextType } from "@/types";

export function useReposition(): RepositionContextType {
  const context = useContext(RepositionContext);

  if (!context) {
    throw new Error("useReposition must be used within RepositionProvider");
  }

  return context;
}
