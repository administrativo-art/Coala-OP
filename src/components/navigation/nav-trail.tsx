"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type NavTrailValue = { trail: string[]; setTrail: (trail: string[]) => void };

const NavTrailContext = createContext<NavTrailValue>({ trail: [], setTrail: () => undefined });

/**
 * Caminho "Área › Grupo › Tela" da rota atual. A barra lateral é a fonte da verdade (é ela que conhece o menu e as
 * permissões) e publica o caminho aqui; a barra superior só o exibe, sem manter um mapa de rótulos próprio.
 */
export function NavTrailProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<string[]>([]);
  const value = useMemo(() => ({ trail, setTrail }), [trail]);
  return <NavTrailContext.Provider value={value}>{children}</NavTrailContext.Provider>;
}

export function useNavTrail() {
  return useContext(NavTrailContext);
}
