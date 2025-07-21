
"use client";

import { AuditDashboard } from "@/components/audit-dashboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

export default function AuditPage() {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-3xl">
                        <ShieldCheck className="h-8 w-8" />
                        Painel de auditoria
                    </CardTitle>
                    <CardDescription>
                        Acompanhe a acurácia do seu estoque, identifique divergências e analise tendências.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <AuditDashboard />
                </CardContent>
            </Card>
        </div>
    );
}
