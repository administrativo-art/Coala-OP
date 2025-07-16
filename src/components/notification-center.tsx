
"use client";

import Link from 'next/link';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Bell, ListTodo } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from './ui/separator';

export interface Task {
  id: string;
  type: string;
  title: string;
  description: string;
  link: string;
  icon: React.FC<any>;
}

interface NotificationCenterProps {
  tasks: Task[];
}

export function NotificationCenter({ tasks }: NotificationCenterProps) {
  const notificationCount = tasks.length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground">
              {notificationCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none flex items-center gap-2">
              <ListTodo className="h-5 w-5" /> Notificações
            </h4>
            <p className="text-sm text-muted-foreground">
              Você tem {notificationCount} {notificationCount === 1 ? 'tarefa pendente' : 'tarefas pendentes'}.
            </p>
          </div>
          <Separator />
          <ScrollArea className="h-72">
            <div className="space-y-2 pr-4">
              {tasks.length > 0 ? (
                tasks.map(task => {
                  const Icon = task.icon;
                  return (
                    <Link href={task.link} key={task.id}>
                      <div className="flex items-start justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors gap-2">
                        <Icon className="h-5 w-5 text-primary shrink-0 mt-1" />
                        <div className="flex-grow">
                          <p className="font-semibold text-sm leading-tight">{task.title}</p>
                          <p className="text-xs text-muted-foreground">{task.description}</p>
                        </div>
                        <Badge variant="secondary" className="shrink-0 text-xs">{task.type}</Badge>
                      </div>
                    </Link>
                  )
                })
              ) : (
                <div className="text-center text-muted-foreground py-10">
                    <p>Nenhuma tarefa pendente.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </PopoverContent>
    </Popover>
  );
}
