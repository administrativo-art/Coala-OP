"use client";

import { useContext } from "react";
import { RepositionRequestContext } from "@/components/reposition-request-provider";
import { type RepositionRequestContextType } from "@/types";

export function useRepositionRequests(): RepositionRequestContextType {
  const context = useContext(RepositionRequestContext);

  if (!context) {
    throw new Error("useRepositionRequests must be used within RepositionRequestProvider");
  }

  return context;
}
