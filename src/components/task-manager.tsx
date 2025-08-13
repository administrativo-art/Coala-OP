
"use client"

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListTodo, CheckCircle2, History, AlertCircle } from 'lucide-react';
import { TaskList } from './task-list';
import { TaskDetailModal } from './task-detail-modal';
import { type Task } from '@/types';
import { useAllTasks } from '@/hooks/use-all-tasks';

export function TaskManager() {
    const { allTasks, loading } = useAllTasks();
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);

    const taskLists = useMemo(() => {
        const pending = allTasks.filter(t => t.status === 'pending' || t.status === 'reopened');
        const awaitingApproval = allTasks.filter(t => t.status === 'awaiting_approval');
        const completed = allTasks.filter(t => t.status === 'completed');
        
        return {
            pending,
            awaiting_approval: awaitingApproval,
            completed,
        };
    }, [allTasks]);

    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ListTodo />
                        Central de tarefas e pendências
                    </CardTitle>
                    <CardDescription>
                        Visualize e gerencie todas as suas tarefas e pendências do sistema em um só lugar.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="pending">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="pending">
                                <AlertCircle className="mr-2 h-4 w-4" /> Pendentes ({taskLists.pending.length})
                            </TabsTrigger>
                            <TabsTrigger value="awaiting_approval">
                                <History className="mr-2 h-4 w-4" /> Aguardando aprovação ({taskLists.awaiting_approval.length})
                            </TabsTrigger>
                            <TabsTrigger value="completed">
                                <CheckCircle2 className="mr-2 h-4 w-4" /> Concluídas
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="pending" className="mt-4">
                            <TaskList tasks={taskLists.pending} onTaskSelect={setSelectedTask} />
                        </TabsContent>
                         <TabsContent value="awaiting_approval" className="mt-4">
                            <TaskList tasks={taskLists.awaiting_approval} onTaskSelect={setSelectedTask} />
                        </TabsContent>
                        <TabsContent value="completed" className="mt-4">
                            <TaskList tasks={taskLists.completed} onTaskSelect={setSelectedTask} />
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>

            <TaskDetailModal
                task={selectedTask}
                onOpenChange={() => setSelectedTask(null)}
            />
        </>
    );
}
