
"use client";

import { useAllTasks } from '@/hooks/use-all-tasks';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from './ui/skeleton';
import { Inbox, ListTodo } from 'lucide-react';
import Link from 'next/link';
import { Button } from './ui/button';

export function PendingTasksDashboard() {
    const { taskNotifications, pendingTaskCount, loading } = useAllTasks();

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-24 w-full" />
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ListTodo /> Tarefas Pendentes ({pendingTaskCount})
                </CardTitle>
                <CardDescription>
                    Resumo de todas as suas pendências que precisam de atenção.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {taskNotifications.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground flex flex-col items-center">
                        <Inbox className="h-10 w-10 mb-2" />
                        <p>Nenhuma tarefa pendente.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {taskNotifications.slice(0, 5).map(task => {
                            const Icon = task.icon;
                            return (
                                <Link href={task.link} key={task.id}>
                                    <div className="flex items-start justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors gap-2">
                                        <Icon className="h-5 w-5 text-primary shrink-0 mt-1" />
                                        <div className="flex-grow">
                                            <p className="font-semibold text-sm leading-tight">{task.title}</p>
                                            <p className="text-xs text-muted-foreground">{task.description}</p>
                                        </div>
                                    </div>
                                </Link>
                            )
                        })}
                         {taskNotifications.length > 5 && (
                            <Link href="/dashboard/tasks">
                                <Button variant="outline" className="w-full mt-2">
                                    Ver todas as {taskNotifications.length} tarefas
                                </Button>
                            </Link>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
