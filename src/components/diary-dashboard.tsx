
"use client";

import React, { useState, useMemo } from 'react';
import { DateRange } from 'react-day-picker';
import { format, parseISO, isValid, differenceInDays } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { CalendarIcon, User, Inbox, Clock, ListOrdered, Timer } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { type DailyLog } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Switch } from './ui/switch';
import { Label } from './ui/label';

const CHART_COLORS = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

export function DiaryDashboard({ logs }: { logs: DailyLog[] }) {
    const { users, loading: usersLoading } = useAuth();
    const [userId, setUserId] = useState<string>('all');
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: new Date(new Date().setDate(1)),
        to: new Date(),
    });
    const [timeUnit, setTimeUnit] = useState<'minutes' | 'hours'>('minutes');

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            const logDate = parseISO(log.logDate);
            if (!isValid(logDate)) return false;

            if (userId !== 'all' && log.author.userId !== userId) return false;
            
            if (dateRange?.from) {
                 const fromDate = new Date(dateRange.from);
                 fromDate.setHours(0, 0, 0, 0);
                 if (logDate < fromDate) return false;
            }
            if (dateRange?.to) {
                const toDate = new Date(dateRange.to);
                toDate.setHours(23, 59, 59, 999);
                if (logDate > toDate) return false;
            }

            return true;
        });
    }, [logs, userId, dateRange]);
    
    const formatDuration = (minutes: number) => {
        if (timeUnit === 'hours') {
            return (minutes / 60);
        }
        return minutes;
    };
    
    const formatNumber = (value: number) => {
        if (timeUnit === 'hours') {
            return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        }
        return new Intl.NumberFormat('pt-BR').format(Math.round(value));
    };


    const { kpis, chartData } = useMemo(() => {
        if (filteredLogs.length === 0) {
            return { kpis: { totalDuration: 0, totalActivities: 0, avgTimePerActivity: 0 }, chartData: [] };
        }

        let totalDuration = 0;
        let totalActivities = 0;
        const activitiesByDay: Record<string, number> = {};
        const durationByDay: Record<string, number> = {};

        filteredLogs.forEach(log => {
            totalDuration += log.totalDurationMinutes || 0;
            totalActivities += log.totalActivities || 0;

            const day = format(parseISO(log.logDate), 'dd/MM');
            activitiesByDay[day] = (activitiesByDay[day] || 0) + (log.totalActivities || 0);
            durationByDay[day] = (durationByDay[day] || 0) + (log.totalDurationMinutes || 0);
        });
        
        const avgTimePerActivity = totalActivities > 0 ? totalDuration / totalActivities : 0;
        
        const chartDataResult = Object.keys(activitiesByDay).map(day => ({
            day,
            atividades: activitiesByDay[day],
            minutos: formatDuration(durationByDay[day]),
        })).sort((a,b) => a.day.localeCompare(b.day, undefined, { numeric: true }));

        return {
            kpis: { 
                totalDuration: formatDuration(totalDuration), 
                totalActivities, 
                avgTimePerActivity: formatDuration(avgTimePerActivity) 
            },
            chartData: chartDataResult
        };
    }, [filteredLogs, timeUnit]);


    if (usersLoading) {
        return <Skeleton className="h-96 w-full" />
    }

    return (
         <Card>
            <CardHeader>
                <CardTitle>Painel de Análise</CardTitle>
                <CardDescription>Métricas de produtividade baseadas nos diários finalizados.</CardDescription>
                <div className="flex flex-wrap gap-4 pt-2 items-center justify-between">
                    <div className="flex flex-wrap gap-2">
                        <Select value={userId} onValueChange={setUserId}>
                            <SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Colaborador" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                {users.map(u => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button id="date" variant="outline" className={cn("w-full sm:w-[260px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (dateRange.to ? <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</> : format(dateRange.from, "LLL dd, y")) : <span>Período</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                            </PopoverContent>
                        </Popover>
                    </div>
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="time-unit-switch" className="text-sm">Min</Label>
                        <Switch
                            id="time-unit-switch"
                            checked={timeUnit === 'hours'}
                            onCheckedChange={(checked) => setTimeUnit(checked ? 'hours' : 'minutes')}
                        />
                        <Label htmlFor="time-unit-switch" className="text-sm">Horas</Label>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4 md:grid-cols-3 mb-6">
                    <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Tempo total</CardTitle><Clock className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{formatNumber(kpis.totalDuration)} {timeUnit === 'hours' ? 'h' : 'min'}</div></CardContent></Card>
                    <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total de Atividades</CardTitle><ListOrdered className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{formatNumber(kpis.totalActivities)}</div></CardContent></Card>
                    <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Tempo médio / Atividade</CardTitle><Timer className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgTimePerActivity.toFixed(1)} {timeUnit === 'hours' ? 'h' : 'min'}</div></CardContent></Card>
                </div>

                {chartData.length > 0 ? (
                    <div className="grid gap-6 md:grid-cols-2">
                         <Card>
                            <CardHeader><CardTitle className="text-base">Atividades por Dia</CardTitle></CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="day" fontSize={12} />
                                        <YAxis allowDecimals={false} />
                                        <Tooltip formatter={(value: number) => formatNumber(value)}/>
                                        <Bar dataKey="atividades" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]}>
                                            <LabelList dataKey="atividades" position="top" formatter={(value: number) => formatNumber(value)}/>
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader><CardTitle className="text-base">Tempo Gasto por Dia ({timeUnit === 'hours' ? 'h' : 'min'})</CardTitle></CardHeader>
                            <CardContent>
                               <ResponsiveContainer width="100%" height={250}>
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="day" fontSize={12} />
                                        <YAxis />
                                        <Tooltip formatter={(value: number) => `${formatNumber(value)} ${timeUnit === 'hours' ? 'h' : 'min'}`} />
                                        <Bar dataKey="minutos" fill={CHART_COLORS[1]} radius={[4, 4, 0, 0]}>
                                            <LabelList dataKey="minutos" position="top" formatter={(value: number) => formatNumber(value)} />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg">
                        <Inbox/>
                        <p className="ml-2">Nenhum dado encontrado para os filtros selecionados.</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
