"use client"

import { useState, useMemo } from 'react';
import { useTasks } from '@/hooks/use-tasks';
import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ListTodo, CheckCircle2, History, AlertCircle, XCircle } from 'lucide-react';
import { TaskList } from './task-list';
import { TaskDetailModal } from './task-detail-modal';
import { type Task } from '@/types';

export function TaskManager() {
    const { tasks, loading, updateTask } = useTasks();
    const { user, users, profiles } = useAuth();
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);

    const myTasks = useMemo(() => {
        if (!user) return [];
        return tasks.filter(task => {
            if (task.assigneeType === 'user' && task.assigneeId === user.id) return true;
            if (task.assigneeType === 'profile' && user.profileId === task.assigneeId) return true;
            if (task.status === 'awaiting_approval') {
                if (task.approverType === 'user' && task.approverId === user.id) return true;
                if (task.approverType === 'profile' && user.profileId === task.approverId) return true;
            }
            return false;
        });
    }, [tasks, user]);

    const taskLists = useMemo(() => ({
        pending: myTasks.filter(t => t.status === 'pending' || t.status === 'reopened'),
        in_progress: myTasks.filter(t => t.status === 'in_progress'),
        awaiting_approval: myTasks.filter(t => t.status === 'awaiting_approval'),
        completed: myTasks.filter(t => t.status === 'completed'),
        rejected: myTasks.filter(t => t.status === 'rejected'),
    }), [myTasks]);


    if (loading) {
        return <Skeleton className="h-96 w-full" />;
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ListTodo />
                        Central de Tarefas
                    </CardTitle>
                    <CardDescription>
                        Visualize e gerencie todas as suas tarefas pendentes e concluídas.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="pending">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="pending">
                                <AlertCircle className="mr-2 h-4 w-4" /> Pendentes ({taskLists.pending.length})
                            </TabsTrigger>
                            <TabsTrigger value="awaiting_approval">
                                <History className="mr-2 h-4 w-4" /> Aguardando Aprovação ({taskLists.awaiting_approval.length})
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
