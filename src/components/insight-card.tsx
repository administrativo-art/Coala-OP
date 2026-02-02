"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus, Lightbulb } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Insight {
    name: string;
    change: number; // percentage
    currentAvg: number;
    unit: string;
}

interface InsightCardProps {
    insights: Insight[];
}

const formatChange = (change: number) => {
    if (change > 500) return "+500%+"
    if (change > 0) return `+${change.toFixed(0)}%`;
    if (change < -500) return "-500%+"
    if (change < 0) return `${change.toFixed(0)}%`;
    return '0%';
}

export function InsightCard({ insights }: InsightCardProps) {
    if (!insights || insights.length === 0) return null;

    return (
        <Card className="mb-6 bg-amber-500/5 border-amber-500/20">
            <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-amber-800 dark:text-amber-200"><Lightbulb/> Insights Automáticos</CardTitle>
                 <CardDescription className="text-amber-700 dark:text-amber-300">Comparação do período selecionado com a média histórica.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {insights.map(insight => {
                    const isUp = insight.change > 5;
                    const isDown = insight.change < -5;
                    const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
                    const color = isUp ? "text-destructive" : isDown ? "text-green-600" : "text-muted-foreground";

                    return (
                        <div key={insight.name} className="p-4 border rounded-lg bg-background shadow-sm">
                            <h4 className="font-semibold truncate">{insight.name}</h4>
                            <div className={cn("flex items-center gap-2 text-2xl font-bold mt-1", color)}>
                                <Icon className="h-6 w-6" />
                                <span>{formatChange(insight.change)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">Média período: {insight.currentAvg.toFixed(2)} {insight.unit}/dia</p>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    )
}
