"use client"

import Link from "next/link"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { ArrowRight, Briefcase, Calculator, Layers, Wallet } from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { GlassCard } from "@/components/ui/glass-card"
import { canViewTechnicalSheets } from "@/lib/commercial-permissions"

function SectionShortcut({ title, description, badge, href, icon, color }: any) {
  return (
    <Link href={href} className="group flex-1">
      <Card className="h-full overflow-hidden border-muted/50 bg-card transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className={`mb-4 rounded-xl bg-${color}-50 p-3 text-${color}-600 dark:bg-${color}-500/10 dark:text-${color}-400`}>
              {icon}
            </div>
            {badge && (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {badge}
              </span>
            )}
          </div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">{title}</h3>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{description}</p>
          <div className="mt-4 flex -translate-x-2 items-center text-sm font-medium text-primary opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100">
            Acessar painel <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

export default function DashboardPage() {
  const { user, permissions } = useAuth()

  if (!permissions.dashboard.view) {
    return (
      <div className="flex h-full items-center justify-center">
        <GlassCard className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>
              Você não tem permissão para visualizar o dashboard. Entre em contato com um administrador.
            </CardDescription>
          </CardHeader>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col justify-between gap-4 border-b border-border/50 pb-6 md:flex-row md:items-end">
        <div>
          <div className="mb-3 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-xs font-semibold text-primary">
            Painel da gestão
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Bem-vindo, {user?.username}!</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Acompanhe a operação pelos painéis gerenciais do sistema.
          </p>
        </div>
        <div className="hidden rounded-lg border border-muted/50 bg-muted/30 px-4 py-2 text-sm text-muted-foreground sm:block">
          {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
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
    </div>
  )
}
