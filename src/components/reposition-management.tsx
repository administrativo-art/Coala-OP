
"use client";

import { useReposition } from "@/hooks/use-reposition";
import { Skeleton } from "./ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Inbox } from "lucide-react";

export function RepositionManagement() {
    const { activities, loading } = useReposition();

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
            </div>
        )
    }

    if (activities.length === 0) {
        return (
            <Card className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground border-2 border-dashed">
                <Inbox className="h-12 w-12 mb-4" />
                <h3 className="text-xl font-semibold text-foreground">Nenhuma atividade de reposição</h3>
                <p className="max-w-md mt-2">
                    Quando uma sugestão de reposição for salva na aba "Análise", ela aparecerá aqui para ser gerenciada.
                </p>
            </Card>
        )
    }

    return (
        <div>
            {activities.map(activity => (
                <div key={activity.id} className="p-4 border rounded-lg mb-4">
                    <p>ID: {activity.id}</p>
                    <p>Status: {activity.status}</p>
                    <p>Origem: {activity.kioskOriginName}</p>
                    <p>Destino: {activity.kioskDestinationName}</p>
                    <p>Itens: {activity.items.length}</p>
                </div>
            ))}
        </div>
    );
}
