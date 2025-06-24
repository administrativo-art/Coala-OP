"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Rocket } from "lucide-react";

export function DeploymentInfo() {
  return (
    <Card className="fixed bottom-4 right-4 w-auto max-w-sm animate-in fade-in-50 slide-in-from-bottom-10 duration-500">
      <CardContent className="p-4 flex items-center gap-4">
        <div className="flex-grow">
          <p className="font-bold">Ambiente de Desenvolvimento</p>
          <p className="text-sm text-muted-foreground">
            Seu app está em modo de desenvolvimento. Para compartilhar, faça o deploy.
          </p>
        </div>
        <Button disabled>
          <Rocket className="mr-2 h-4 w-4" />
          Deploy
        </Button>
      </CardContent>
    </Card>
  );
}
