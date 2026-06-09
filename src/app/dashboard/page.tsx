"use client"

import { useMemo, useState, useEffect } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GlassCard } from "@/components/ui/glass-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { format } from "date-fns"
import { ptBR } from 'date-fns/locale'
import { Users, LayoutDashboard, Briefcase, Calculator, Layers, ArrowRight, Wallet, ClipboardCheck, ListOrdered, CalendarDays, Target, Loader2, Clock, CheckCircle2 } from 'lucide-react'
import { collection, onSnapshot, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { canViewTechnicalSheets } from "@/lib/commercial-permissions";
import { fetchMyFormExecutions } from "@/features/forms/lib/client";
import type { FormExecution } from "@/types/forms";

interface OnlineUser {
    id: string;
    username: string;
    status: 'online' | 'offline';
    last_seen: Date;
}

const STATUS_LABELS: Record<FormExecution["status"], string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  completed: "Concluído",
  overdue: "Atrasado",
  canceled: "Cancelado",
};

const STATUS_CLASS: Record<FormExecution["status"], string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-red-200 bg-red-50 text-red-700",
  canceled: "border-slate-200 bg-slate-100 text-slate-600",
};

function formatDateTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
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

function CollaboratorActionCard({
  title,
  description,
  href,
  icon,
  enabled,
  actionLabel,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  enabled: boolean;
  actionLabel: string;
}) {
  const content = (
    <Card className={`h-full border-muted/50 shadow-sm transition-all ${enabled ? "hover:border-primary/20 hover:shadow-md" : "opacity-60"}`}>
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between">
          <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? "Disponível" : "Sem permissão"}</Badge>
          <Button size="sm" variant="ghost" disabled={!enabled}>
            {actionLabel}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  if (!enabled) return content;

  return (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  );
}

function CollaboratorPanel({ permissions }: { permissions: ReturnType<typeof useAuth>["permissions"] }) {
  const { firebaseUser } = useAuth();
  const [executions, setExecutions] = useState<FormExecution[]>([]);
  const [loadingForms, setLoadingForms] = useState(true);
  const [formsError, setFormsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!firebaseUser) {
        setLoadingForms(false);
        return;
      }

      try {
        setLoadingForms(true);
        setFormsError(null);
        const payload = await fetchMyFormExecutions(firebaseUser);
        if (!cancelled) setExecutions(payload.executions);
      } catch (error) {
        if (!cancelled) {
          setFormsError(error instanceof Error ? error.message : "Falha ao carregar formulários.");
        }
      } finally {
        if (!cancelled) setLoadingForms(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const pendingForms = useMemo(
    () => executions.filter((execution) => execution.status === "pending" || execution.status === "overdue"),
    [executions]
  );

  const canUseStockCount = !!(permissions.stock?.stockCount?.view || permissions.stock?.stockCount?.perform);
  const canViewSchedule = !!permissions.dp?.schedules?.view;
  const canViewGoals = !!permissions.goals?.view;

  return (
    <section id="painel-colaborador" className="scroll-mt-6 space-y-4">
      <div className="flex flex-col gap-2 border-b border-border/50 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 mb-3">
            Painel do colaborador
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Rotinas do dia</h2>
          <p className="text-sm text-muted-foreground">
            Atalhos para o que precisa ser executado pelo usuário logado.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/forms/mine">
            Ver meus formulários
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="border-muted/50 shadow-sm">
          <CardHeader className="border-b border-muted/30 pb-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-primary" />
                  Formulários a preencher
                </CardTitle>
                <CardDescription>Pendentes e atrasados atribuídos ao colaborador.</CardDescription>
              </div>
              <Badge className={pendingForms.length > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                {pendingForms.length} pendente(s)
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {loadingForms ? (
              <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando formulários...
              </div>
            ) : formsError ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {formsError}
              </div>
            ) : pendingForms.length === 0 ? (
              <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
                Nenhum formulário pendente agora.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingForms.slice(0, 3).map((execution) => (
                  <Link key={execution.id} href={`/dashboard/forms/${execution.id}/view`} className="block">
                    <div className="rounded-xl border p-4 transition-colors hover:bg-muted/40">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{execution.template_name}</p>
                            <Badge className={STATUS_CLASS[execution.status]}>{STATUS_LABELS[execution.status]}</Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {execution.unit_name ?? execution.unit_id}
                            {execution.shift_definition_name ? ` · ${execution.shift_definition_name}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground md:text-right">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDateTime(execution.due_at)}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
          <CollaboratorActionCard
            title="Contagem"
            description="Abrir a contagem de estoque da operação."
            href="/dashboard/stock/count"
            icon={<ListOrdered className="h-5 w-5" />}
            enabled={canUseStockCount}
            actionLabel="Contar"
          />
          <CollaboratorActionCard
            title="Minha escala"
            description="Consultar os turnos e períodos da unidade."
            href="/dashboard/dp/schedules"
            icon={<CalendarDays className="h-5 w-5" />}
            enabled={canViewSchedule}
            actionLabel="Ver escala"
          />
          <CollaboratorActionCard
            title="Metas"
            description="Acompanhar desempenho e metas em aberto."
            href="/dashboard/goals/tracking"
            icon={<Target className="h-5 w-5" />}
            enabled={canViewGoals}
            actionLabel="Acompanhar"
          />
        </div>
      </div>
    </section>
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
                    Painel do gestor
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight">Bem-vindo, {user?.username}!</h1>
                  <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                      Acompanhe a operação pelos painéis gerenciais e, abaixo, execute suas rotinas do dia.
                  </p>
                </div>
                <div className="text-sm text-muted-foreground bg-muted/30 px-4 py-2 rounded-lg border border-muted/50 hidden sm:block">
                  {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
                </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-emerald-800">Painel do colaborador disponível abaixo</p>
                <p className="text-xs text-muted-foreground">Acesse formulários, contagem, escala e metas do usuário logado.</p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href="#painel-colaborador">
                  Ir para painel
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </a>
              </Button>
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
              
              {(permissions.pricing.view || permissions.goals?.view || canViewTechnicalSheets(permissions)) && (
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

            <CollaboratorPanel permissions={permissions} />

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
