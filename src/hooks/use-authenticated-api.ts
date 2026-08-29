"use client";

import { useCallback } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  authenticatedApiRequest,
  type AuthenticatedApiRequestInit,
} from "@/lib/authenticated-api-client";

export function useAuthenticatedApi() {
  const { firebaseUser } = useAuth();

  return useCallback(
    async <T = unknown>(input: RequestInfo | URL, init: AuthenticatedApiRequestInit = {}) =>
      authenticatedApiRequest<T>(input, {
        ...init,
        getIdToken: async () => firebaseUser?.getIdToken() ?? null,
      }),
    [firebaseUser],
  );
}
