"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { GlassCard } from "@/components/ui/glass-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import { Wifi, Users, LayoutDashboard, Briefcase, Calculator, Layers, ArrowRight, Wallet } from 'lucide-react'
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface OnlineUser {
    id: string;
    username: string;
    status: 'online' | 'offline';
    last_seen: Date;
}

function OnlineUsersPanel() {
    const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const q = query(
            collection(db, "userPresence"), 
            where("last_seen", ">", fiveMinutesAgo)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const users: OnlineUser[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.status === 'online') {
                    const lastSeen = (data.last_seen as Timestamp)?.toDate();
                    if (lastSeen) {
                        users.push({
                            id: doc.id,
                            username: data.username,
                            status: data.status,
                            last_seen: lastSeen,
                        });
                    }
                }
            });
            setOnlineUsers(users.sort((a,b) => a.username.localeCompare(b.username)));
        });

        const timer = setInterval(() => setNow(new Date()), 30 * 1000);

        return () => {
            unsubscribe();
            clearInterval(timer);
        };
    }, []);

    return (
        <Card className="flex flex-col h-full border-muted/50 shadow-sm">
            <CardHeader className="pb-3 border-b border-muted/30">
                <CardTitle className="flex items-center gap-2 text-base">
                  <div className="relative flex h-3 w-3 mr-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </div>
                  Usuários Online ({onlineUsers.length})
                </CardTitle>
                <CardDescription className="text-xs">
                    Usuários ativos no sistema nos últimos 5 minutos.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
                <ScrollArea className="h-[280px]">
                    <div className="p-4 space-y-2">
                        {onlineUsers.length > 0 ? onlineUsers.map(user => (
                             <div key={user.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-muted/40 hover:bg-muted/60 transition-colors">
                                 <div>
                                    <p className="font-semibold text-sm">{user.username}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                        Visto por último: {format(user.last_seen, "'às' HH:mm", { locale: ptBR })}
                                    </p>
                                </div>
                                <div className="h-1.5 w-1.5 rounded-full bg-green-500"></div>
                             </div>
                        )) : (
                            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                                <Users className="h-8 w-8 mb-3 opacity-20"/>
                                <p className="text-sm">Nenhum usuário online no momento.</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    )
}

function SectionShortcut({ title, description, badge, href, icon, color }: any) {
  return (
    <Link href={href} className="group flex-1">
      <Card className="h-full overflow-hidden border-muted/50 transition-all hover:shadow-md hover:border-primary/20 bg-card group-hover:-translate-y-0.5">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className={`p-3 rounded-xl bg-${color}-50 dark:bg-${color}-500/10 text-${color}-600 dark:text-${color}-400 mb-4`}>
              {icon}
            </div>
            {badge && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {badge}
              </span>
            )}
          </div>
          <h3 className="font-semibold text-lg items-center gap-2 flex">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
            {description}
          </p>
          <div className="mt-4 flex items-center text-sm font-medium text-primary opacity-0 -translate-x-2 transition-all group-hover:opacity-100 group-hover:translate-x-0">
            Acessar painel <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
    const { user, permissions } = useAuth();
    
    if (!permissions.dashboard.view) {
        return (
            <div className="flex items-center justify-center h-full">
                <GlassCard className="w-full max-w-md text-center">
                    <CardHeader>
                        <CardTitle>Acesso Negado</CardTitle>
                        <CardDescription>
                            Você não tem permissão para visualizar o dashboard. Entre em contato com um administrador.
                        </CardDescription>
                    </CardHeader>
                </GlassCard>
            </div>
        );
    }
    
    return (
        <div className="space-y-8 pb-8">
            {/* Header / Welcome */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/50 pb-6">
                <div>
                  <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-xs font-semibold text-primary mb-3">
                    Painel Central Coala
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight">Bem-vindo, {user?.username}!</h1>
                  <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                      Escolha um dos nossos painéis especializados para iniciar seu trabalho hoje.
                  </p>
                </div>
                <div className="text-sm text-muted-foreground bg-muted/30 px-4 py-2 rounded-lg border border-muted/50 hidden sm:block">
                  {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
                </div>
            </div>
            
            {/* Core Panels Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {permissions.dashboard.operational && (
                <SectionShortcut 
                  title="Operações"
                  description="Acompanhamento de estoque, validades, reposição entre quiosques e gestão de tarefas."
                  href="/dashboard/operations"
                  icon={<Layers className="h-6 w-6" />}
                  color="blue"
                  badge="Estoque & Tarefas"
                />
              )}
              
              {permissions.dashboard.pricing && (
                <SectionShortcut 
                  title="Comercial"
                  description="Gestão de preços de venda, fichas técnicas, margem de contribuição e análise de metas."
                  href="/dashboard/commercial"
                  icon={<Calculator className="h-6 w-6" />}
                  color="emerald"
                  badge="Metas & Preços"
                />
              )}

              {permissions.dp?.view && (
                <SectionShortcut 
                  title="Departamento Pessoal"
                  description="Controle de escalas, gestão de férias dos colaboradores, aniversariantes e turnos da equipe."
                  href="/dashboard/dp"
                  icon={<Briefcase className="h-6 w-6" />}
                  color="purple"
                  badge="RH & Escalas"
                />
              )}

              {permissions.financial?.view && (
                <SectionShortcut
                  title="Financeiro"
                  description="Fluxo de caixa, DRE, despesas, importação de extrato e cadastros financeiros no banco dedicado."
                  href="/dashboard/financial"
                  icon={<Wallet className="h-6 w-6" />}
                  color="amber"
                  badge="Caixa & DRE"
                />
              )}
            </div>

            {/* Bottom Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
              <div className="lg:col-span-2">
                <Card className="h-full border-muted/50 shadow-sm flex flex-col justify-center items-center text-center p-8 bg-gradient-to-br from-card to-muted/20">
                    <LayoutDashboard className="h-12 w-12 text-muted-foreground/30 mb-4" />
                    <h3 className="text-xl font-semibold mb-2">Painéis Especializados</h3>
                    <p className="text-sm text-muted-foreground max-w-md">
                      Transferimos todos os widgets detalhados para painéis dedicados na nova barra lateral. Acesse <strong className="text-foreground">Operações</strong>, <strong className="text-foreground">Comercial</strong> ou o <strong className="text-foreground">DP</strong> para as funções avançadas.
                    </p>
                </Card>
              </div>
              <div className="lg:col-span-1">
                <OnlineUsersPanel />
              </div>
            </div>
        </div>
    );
}
