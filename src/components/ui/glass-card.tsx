
// components/ui/glass-card.tsx
import React from "react";
import { Card as ShadcnCard } from "@/components/ui/card";
import { cn } from "@/lib/utils"; // Sua função utilitária padrão do shadcn

// Uma sombra personalizada mais suave para o efeito de vidro
const glassShadow = "shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "red" | "amber"; // Para os cards de divergência
}

export function GlassCard({ className, variant = "default", children, ...props }: GlassCardProps) {
  
  // Define as cores baseadas na variante
  const variantStyles = {
    default: "bg-white/40 dark:bg-slate-900/40 border-white/30 dark:border-white/10",
    red:     "bg-red-500/10 dark:bg-red-900/20 border-red-500/20 dark:border-red-500/10",
    amber:   "bg-amber-500/10 dark:bg-amber-900/20 border-amber-500/20 dark:border-amber-500/10",
  };

  return (
    <ShadcnCard
      className={cn(
        // 1. Resetar estilos do Shadcn que atrapalham o vidro
        "bg-transparent shadow-none", 
        
        // 2. Aplicar o efeito Glass base
        "backdrop-blur-md border", 
        glassShadow,
        
        // 3. Aplicar a cor da variante escolhida
        variantStyles[variant],

        // 4. Permitir classes extras passadas via props
        className
      )}
      {...props}
    >
      {children}
    </ShadcnCard>
  );
}

// Você também pode exportar o Header, Content, etc., se quiser que eles herdem algo,
// mas geralmente só o wrapper do Card é suficiente.
export { CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
