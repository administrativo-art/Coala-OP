
"use client";

import { useMemo } from 'react';
import { useTasks } from '@/hooks/use-tasks';
import { useAuth } from '@/hooks/use-auth';
import { differenceInHours, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Skeleton } from './ui/skeleton';
import { AlertCircle, AreaChart, BarChart2, CheckCircle, Clock, FileText, Inbox, User, Users } from 'lucide-react';

// Helper to truncate long labels for charts
const truncateLabel = (label: string, maxLength = 25) => {
    if (label.length <= maxLength) return label;
    return `${label.substring(0, maxLength)}...`;
};

export function ReportsDashboard() {
    const { tasks, loading: loadingTasks } = useTasks();
    const { users, loading: loadingUsers } = useAuth();
    
    const loading = loadingTasks || loadingUsers;

    const stats = useMemo(() => {
        if (loading) return null;
        
        // Tempo médio de conclusão
        const completedTasks = tasks.filter(t => t.status === 'completed' && t.completedAt);
        const completionTimes = completedTasks.map(t => differenceInHours(parseISO(t.completedAt!), parseISO(t.createdAt)));
        const averageCompletionTime = completionTimes.length > 0
            ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
            : 0;
            
        // Pergunta que gerou mais tarefas (mantendo lógica, mas pode ser menos útil agora)
        const questionTaskCounts = tasks.reduce((acc, task) => {
            if (task.origin.questionId) {
                const questionId = task.origin.questionId;
                acc[questionId] = (acc[questionId] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);
        
        const questionData = Object.entries(questionTaskCounts)
            .map(([id, count]) => ({ name: `Pergunta ${id.slice(0,5)}`, count }))
            .sort((a,b) => b.count - a.count)
            .slice(0, 10);
            
        // Formulário que gerou mais tarefas (mantendo lógica, mas pode ser menos útil agora)
        const formTaskCounts = tasks.reduce((acc, task) => {
            if (task.origin.type === 'form') {
                const templateId = task.origin.id;
                acc[templateId] = (acc[templateId] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);
        
        const formData = Object.entries(formTaskCounts)
            .map(([id, count]) => ({ name: `Formulário ${id.slice(0,5)}`, count }))
            .sort((a,b) => b.count - a.count)
            .slice(0, 10);
            
        // Usuário com mais tarefas atribuídas
        const userTaskCounts = tasks.reduce((acc, task) => {
            acc[task.assigneeId] = (acc[task.assigneeId] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        const userLabels = new Map(users.map(u => [u.id, u.username]));

        const userData = Object.entries(userTaskCounts)
             .map(([id, count]) => ({ name: userLabels.get(id) || `Usuário ${id.slice(0,5)}`, count }))
             .sort((a,b) => b.count - a.count)
             .slice(0, 10);
             
        // Tipo de tarefa mais frequente
        const taskTypeCounts = tasks.reduce((acc, task) => {
            acc[task.title] = (acc[task.title] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        const taskTypeData = Object.entries(taskTypeCounts)
            .map(([name, count]) => ({ name: truncateLabel(name), count }))
            .sort((a,b) => b.count - a.count)
            .slice(0, 10);

        return {
            averageCompletionTime,
            questionData,
            formData,
            userData,
            taskTypeData
        };
        
    }, [loading, tasks, users]);

    const renderChart = (title: string, description: string, data: {name: string, count: number}[], Icon: React.ElementType) => (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" /> {title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {data.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis type="category" dataKey="name" width={120} interval={0} tick={{ fontSize: 12 }} />
                            <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} />
                            <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                                <LabelList dataKey="count" position="right" />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                        <Inbox className="h-8 w-8 mr-2" />
                        <span>Sem dados suficientes</span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
    
    if(loading) {
        return <Skeleton className="w-full h-[600px]" />
    }

    return (
        <div className="space-y-6">
            <CardHeader className="p-0">
                <CardTitle className="flex items-center gap-2 text-3xl"><AreaChart/> Relatórios</CardTitle>
                <CardDescription>Métricas e análises sobre as tarefas do sistema.</CardDescription>
            </CardHeader>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Tempo médio de conclusão</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats?.averageCompletionTime.toFixed(1) || 0} horas</div>
                        <p className="text-xs text-muted-foreground">Média para tarefas concluídas</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de Tarefas</CardTitle>
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{tasks.length}</div>
                        <p className="text-xs text-muted-foreground">Total de tarefas criadas no sistema</p>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Tarefas Concluídas</CardTitle>
                        <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{tasks.filter(t => t.status === 'completed').length}</div>
                        <p className="text-xs text-muted-foreground">Total de tarefas finalizadas</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {stats && renderChart("Tarefas por Usuário", "Top 10 usuários por número de tarefas atribuídas.", stats.userData, Users)}
                {stats && renderChart("Tipos de tarefa mais frequentes", "Top 10 tipos de tarefas por frequência.", stats.taskTypeData, BarChart2)}
            </div>
        </div>
    );
}
