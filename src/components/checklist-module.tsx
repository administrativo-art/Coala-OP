"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/use-auth"
import { ChecklistTemplateManager } from "./checklist-template-manager"
import { CheckSquare } from "lucide-react"

export function ChecklistModule() {
    const { permissions } = useAuth()

    return (
        <Card className="w-full mx-auto animate-in fade-in zoom-in-95">
            <CardHeader>
                <CardTitle className="text-center font-headline flex items-center justify-center gap-2">
                   <CheckSquare /> Módulo de Checklist
                </CardTitle>
                <CardDescription className="text-center">Crie e gerencie checklists para as operações diárias.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="fill">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="fill" disabled={!permissions.checklists.fill}>Preencher Checklist</TabsTrigger>
                        <TabsTrigger value="history" disabled={!permissions.checklists.viewHistory}>Histórico</TabsTrigger>
                        {permissions.checklists.manage && <TabsTrigger value="manage">Gerenciar Modelos</TabsTrigger>}
                    </TabsList>
                    
                    <TabsContent value="fill" className="mt-6">
                         <div className="text-center py-16 text-muted-foreground">
                            <p>Funcionalidade em desenvolvimento.</p>
                            <p className="text-sm">Primeiro, crie um modelo na aba "Gerenciar Modelos".</p>
                        </div>
                    </TabsContent>
                    <TabsContent value="history" className="mt-6">
                        <div className="text-center py-16 text-muted-foreground">
                            <p>Funcionalidade em desenvolvimento.</p>
                        </div>
                    </TabsContent>
                    {permissions.checklists.manage && (
                         <TabsContent value="manage" className="mt-6">
                           <ChecklistTemplateManager />
                        </TabsContent>
                    )}
                </Tabs>
            </CardContent>
        </Card>
    )
}