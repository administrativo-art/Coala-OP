"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import type { ElementType, ReactNode } from "react"
import { addDays, endOfMonth, endOfWeek, format, isBefore, startOfDay, startOfWeek } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Calendar,
  CalendarDays,
  CircleDollarSign,
  Boxes,
  Cpu,
  ListTodo,
  Target,
  TrendingUp,
  UsersRound,
  Wallet,
  Workflow,
} from "lucide-react"
import { useRouter } from "next/navigation"

import { GoalsProvider } from "@/components/goals-provider"
import { useDP } from "@/components/dp-context"
import { GlassCard } from "@/components/ui/glass-card"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useGoals } from "@/contexts/goals-context"
import { useSalesReports } from "@/contexts/sales-report-context"
import { useAuth } from "@/hooks/use-auth"
import { useBaseProducts } from "@/hooks/use-base-products"
import { useConsumptionAnalysis } from "@/hooks/use-consumption-analysis"
import { useDPShifts } from "@/hooks/use-dp-shifts"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useKiosks } from "@/hooks/use-kiosks"
import { useReplenishmentPolicy } from '@/hooks/use-replenishment-policy'
import { operationalMinimum, shortage } from '@/lib/replenishment-display'
import { useProducts } from "@/hooks/use-products"
import { useAllTasks } from "@/hooks/use-all-tasks"
import { financialCollection } from "@/features/financial/lib/repositories"
import { useFinancialCollection } from "@/features/financial/hooks/use-financial-collection"
import { formatCurrency, toDate } from "@/features/financial/lib/utils"
import { ManagementDashboardBuilder, ManagementWidgetFrame } from "@/features/management-dashboard/builder-context"
import type { ManagementWidgetId } from "@/features/management-dashboard/types"
import { canViewTechnicalSheets } from "@/lib/commercial-permissions"
import { cn } from "@/lib/utils"
import type { DPSchedule, DPShift, GoalPeriodDoc, Kiosk, SalesReport, User } from "@/types"

const numberFormatter = new Intl.NumberFormat("pt-BR")
function isSameOrBefore(left: Date, right: Date) {
  return left.getTime() <= right.getTime()
}

function isSameOrAfter(left: Date, right: Date) {
  return left.getTime() >= right.getTime()
}

function getCurrentGoalPeriods(periods: GoalPeriodDoc[], today: Date) {
  return periods.filter((period) => {
    if (period.status !== "active") return false
    const start = toDate(period.startDate)
    const end = toDate(period.endDate)
    return !!start && !!end && isSameOrBefore(startOfDay(start), today) && isSameOrAfter(startOfDay(end), today)
  })
}

function getKioskName(kiosks: Kiosk[], kioskId: string) {
  return kiosks.find((kiosk) => kiosk.id === kioskId)?.name ?? kioskId
}

function DashboardCard({
  widgetId,
  title,
  description,
  href,
  icon: Icon,
  className,
  hideDetailsLink,
  children,
}: {
  widgetId: ManagementWidgetId
  title: string
  description: string
  href: string
  icon: ElementType
  className?: string
  hideDetailsLink?: boolean
  children: ReactNode
}) {
  return (
    <ManagementWidgetFrame id={widgetId} className={className}>
    <Card className="h-full overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface shadow-ds-lift">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-5 pb-2 pt-4">
        <div>
          <CardTitle className="text-[15px] font-extrabold tracking-tight text-ds-ink">{title}</CardTitle>
          <CardDescription className="mt-1 max-w-[360px] text-xs leading-snug text-ds-ink-faint">{description}</CardDescription>
        </div>
        <div className="rounded-ds-sm bg-ds-accent-soft p-2 text-ds-accent-ink">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        {children}
        {!hideDetailsLink ? (
          <Link href={href} className="inline-flex items-center gap-2 px-1 text-xs font-extrabold text-ds-accent-ink hover:text-ds-accent-ink-hover">
            Ver detalhes <ArrowRight className="h-4 w-4" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
    </ManagementWidgetFrame>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-ds-btn border border-dashed border-ds-border px-3 py-4 text-xs text-ds-ink-faint">{children}</p>
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-ds-btn border border-ds-border bg-ds-surface p-3 shadow-sm">
      <p className="text-xs font-semibold text-ds-ink-faint">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold tracking-tight text-ds-ink">{value}</p>
      {detail ? <p className="mt-0.5 text-[11px] font-medium text-ds-ink-faint">{detail}</p> : null}
    </div>
  )
}

function ModuleShortcutCard({ widgetId, title, description, href, icon, links }: { widgetId: ManagementWidgetId; title: string; description: string; href: string; icon: ElementType; links: Array<{ label: string; href: string }> }) {
  return (
    <DashboardCard widgetId={widgetId} title={title} description={description} href={href} icon={icon}>
      <div className="grid gap-2">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="flex items-center justify-between rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2.5 text-xs font-bold text-ds-ink hover:bg-ds-muted">
            {link.label}<ArrowRight className="h-3.5 w-3.5 text-ds-ink-faint" />
          </Link>
        ))}
      </div>
    </DashboardCard>
  )
}

function getShiftUserName(schedule: DPSchedule | undefined, shift: DPShift, users: User[]) {
  return schedule?.snapshot?.users?.[shift.userId]?.username
    ?? shift.userName
    ?? users.find((user) => user.id === shift.userId)?.username
    ?? "Colaborador não identificado"
}

function getShiftLabel(shift: DPShift) {
  if (shift.type === "day_off") return "Folga"
  return `${shift.startTime || "--:--"} - ${shift.endTime || "--:--"}`
}

function formatSalesPeriod(reports: SalesReport[]) {
  const report = reports[0]
  if (!report) return "sem período"
  return format(new Date(report.year, report.month - 1, 1), "MMMM/yyyy", { locale: ptBR })
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value)
}

function getSalesReportRevenue(report: SalesReport) {
  return report.items.reduce((sum, item) => sum + item.quantity * (item.unitPrice ?? 0), 0)
}

function getProjectedRevenue(reports: SalesReport[], today: Date) {
  const reference = reports[0]
  if (!reference) {
    return { value: 0, detail: "sem relatórios no período" }
  }

  const daysInMonth = endOfMonth(new Date(reference.year, reference.month - 1, 1)).getDate()
  const isCurrentMonth = reference.month === today.getMonth() + 1 && reference.year === today.getFullYear()
  const revenue = reports.reduce((sum, report) => sum + getSalesReportRevenue(report), 0)

  if (!isCurrentMonth) {
    return { value: revenue, detail: "período fechado" }
  }

  const reportedDays = new Set(
    reports
      .filter((report) => typeof report.day === "number")
      .map(getReportDateKey)
  )
  const elapsedDays = Math.max(1, reportedDays.size || Math.min(today.getDate(), daysInMonth))
  const projected = (revenue / elapsedDays) * daysInMonth

  return {
    value: projected,
    detail: `média de ${elapsedDays} dia(s) x ${daysInMonth} dias`,
  }
}

function getInitials(value: string) {
  return value
    .split(/\s|\.|-/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "DP"
}

function getVacationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    APPROVED: "Aprovada",
    PLANNED: "Planejada",
    PENDING: "Pendente",
    REJECTED: "Rejeitada",
  }
  return labels[status] ?? status
}

function getTaskStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pendente",
    reopened: "Reaberta",
    in_progress: "Em andamento",
    awaiting_approval: "Aguardando aprovação",
    completed: "Concluída",
    rejected: "Rejeitada",
  }
  return labels[status] ?? status
}

function reportBelongsToSameElapsedPeriod(report: { day?: number }, referenceDay: number) {
  return typeof report.day !== "number" || report.day <= referenceDay
}

function getReportDateKey(report: { year: number; month: number; day?: number }) {
  const day = typeof report.day === "number" ? report.day : 1
  return `${report.year}-${String(report.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function ManagementDashboard() {
  const { firebaseUser, user, users, permissions } = useAuth()
  const router = useRouter()
  const canViewManagementDashboard = permissions.dashboard.view
  const canViewCollaboratorDashboard = permissions.dashboard.collaborator ?? permissions.dashboard.view

  const { kiosks } = useKiosks()
  const { periods, loading: goalsLoading } = useGoals()
  const { salesReports } = useSalesReports()
  const { history: consumptionReports } = useConsumptionAnalysis()
  const { lots } = useExpiryProducts()
  const { products } = useProducts()
  const { baseProducts } = useBaseProducts()
  const { enabled: policyEnabled, error: policyError } = useReplenishmentPolicy()
  const { allTasks, taskNotifications, pendingReceipts, pendingTaskCount, loading: tasksLoading } = useAllTasks()
  const { units, schedules, vacations, schedulesLoading, vacationsLoading } = useDP()
  const { data: expenses, loading: expensesLoading } = useFinancialCollection<any>(
    permissions.financial?.view ? financialCollection("expenses") : null
  )
  const [selectedScheduleUnitId, setSelectedScheduleUnitId] = useState("")
  const [monthlyScheduleUnitId, setMonthlyScheduleUnitId] = useState("")
  const [selectedSalesKioskId, setSelectedSalesKioskId] = useState("all")
  const [vacationStatusFilter, setVacationStatusFilter] = useState("all")
  const [goalsModalOpen, setGoalsModalOpen] = useState(false)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [salesModalOpen, setSalesModalOpen] = useState(false)
  const [paymentsModalOpen, setPaymentsModalOpen] = useState(false)
  const [vacationsModalOpen, setVacationsModalOpen] = useState(false)
  const userNameById = useMemo(
    () => new Map(users.map((item) => [item.id, item.username])),
    [users]
  )

  useEffect(() => {
    if (!canViewManagementDashboard && canViewCollaboratorDashboard) {
      router.replace("/dashboard/collaborator")
    }
  }, [canViewCollaboratorDashboard, canViewManagementDashboard, router])

  const today = startOfDay(new Date())
  const monthEnd = endOfMonth(today)

  const pendingNewTasks = useMemo(
    () => allTasks.filter((task) => ["pending", "reopened", "in_progress", "awaiting_approval"].includes(task.status)),
    [allTasks]
  )

  const overdueTasks = useMemo(
    () =>
      pendingNewTasks.filter((task) => {
        const dueDate = task.dueDate ? startOfDay(new Date(task.dueDate)) : null
        return !!dueDate && isBefore(dueDate, today)
      }),
    [pendingNewTasks, today]
  )

  const dueTodayTasks = useMemo(
    () =>
      pendingNewTasks.filter((task) => {
        const dueDate = task.dueDate ? startOfDay(new Date(task.dueDate)) : null
        return !!dueDate && dueDate.getTime() === today.getTime()
      }),
    [pendingNewTasks, today]
  )

  const approvalTasks = pendingNewTasks.filter((task) => task.status === "awaiting_approval")
  const visiblePendingTasks = pendingNewTasks.slice(0, 3)

  const salesFilteredByUnit = useMemo(
    () => salesReports.filter((report) => selectedSalesKioskId === "all" || report.kioskId === selectedSalesKioskId),
    [salesReports, selectedSalesKioskId]
  )

  const currentReports = useMemo(
    () => salesFilteredByUnit.filter((report) => report.month === today.getMonth() + 1 && report.year === today.getFullYear()),
    [salesFilteredByUnit, today]
  )

  const latestSalesPeriod = salesFilteredByUnit[0] ? { month: salesFilteredByUnit[0].month, year: salesFilteredByUnit[0].year } : null
  const visibleSalesReports = useMemo(() => {
    if (currentReports.length > 0 || !latestSalesPeriod) return currentReports
    return salesFilteredByUnit.filter((report) => report.month === latestSalesPeriod.month && report.year === latestSalesPeriod.year)
  }, [currentReports, latestSalesPeriod, salesFilteredByUnit])

  const previousReports = useMemo(() => {
    const reference = visibleSalesReports[0]
    if (!reference) return []
    const previousDate = new Date(reference.year, reference.month - 2, 1)
    return salesFilteredByUnit.filter((report) => report.month === previousDate.getMonth() + 1 && report.year === previousDate.getFullYear())
  }, [salesFilteredByUnit, visibleSalesReports])

  const sameElapsedCurrentReports = useMemo(
    () => visibleSalesReports.filter((report) => reportBelongsToSameElapsedPeriod(report, today.getDate())),
    [today, visibleSalesReports]
  )

  const sameElapsedPreviousReports = useMemo(
    () => previousReports.filter((report) => reportBelongsToSameElapsedPeriod(report, today.getDate())),
    [previousReports, today]
  )

  const currentRevenue = useMemo(
    () =>
      visibleSalesReports.reduce((sum, report) => sum + getSalesReportRevenue(report), 0),
    [visibleSalesReports]
  )

  const projectedRevenue = useMemo(
    () => getProjectedRevenue(visibleSalesReports, today),
    [today, visibleSalesReports]
  )

  const currentGoals = useMemo(() => getCurrentGoalPeriods(periods, today), [periods, today])

  const goalsByKiosk = useMemo(() => {
    return currentGoals
      .reduce((acc, period) => {
        const existing = acc.get(period.kioskId) ?? { kioskId: period.kioskId, current: 0, target: 0 }
        existing.current += period.currentValue || 0
        existing.target += period.targetValue || 0
        acc.set(period.kioskId, existing)
        return acc
      }, new Map<string, { kioskId: string; current: number; target: number }>())
      .values()
  }, [currentGoals])

  const goalRows = Array.from(goalsByKiosk)
    .map((row) => ({ ...row, name: getKioskName(kiosks, row.kioskId), progress: row.target ? row.current / row.target : 0 }))
    .sort((a, b) => b.target - a.target)

  const cdKiosk = useMemo(
    () =>
      kiosks.find((kiosk) => /centro|distribui|matriz/i.test(kiosk.name) || kiosk.id === "matriz") ??
      kiosks.find((kiosk) => kiosk.id === "cd"),
    [kiosks]
  )

  const averageDailyConsumptionByBaseId = useMemo(() => {
    const demandReports = consumptionReports
      .filter((report) => report.kioskId !== cdKiosk?.id)
      .filter((report) => report.month === today.getMonth() + 1 && report.year === today.getFullYear())
      .filter((report) => reportBelongsToSameElapsedPeriod(report, today.getDate()))

    const days = new Set(demandReports.map(getReportDateKey))
    const divisor = Math.max(1, days.size || today.getDate())

    const totals = demandReports.reduce((acc, report) => {
      report.results.forEach((item) => {
        if (!item.baseProductId) return
        acc.set(item.baseProductId, (acc.get(item.baseProductId) ?? 0) + Number(item.consumedQuantity || 0))
      })
      return acc
    }, new Map<string, number>())

    return Array.from(totals.entries()).reduce((acc, [baseId, quantity]) => {
      acc.set(baseId, quantity / divisor)
      return acc
    }, new Map<string, number>())
  }, [cdKiosk?.id, consumptionReports, today])

  const criticalRestockItems = useMemo(() => {
    if (!cdKiosk) return []
    const productById = new Map(products.map((product) => [product.id, product]))
    const lotsByBase = lots
      .filter((lot) => lot.kioskId === cdKiosk.id)
      .reduce((acc, lot) => {
        const product = productById.get(lot.productId)
        const baseId = product?.baseProductId ?? lot.productId
        acc.set(baseId, (acc.get(baseId) ?? 0) + Number(lot.quantity || 0) - Number(lot.reservedQuantity || 0))
        return acc
      }, new Map<string, number>())

    return baseProducts
      .map((base) => {
        const stockLevel = base.stockLevels?.[cdKiosk.id]
        const current = lotsByBase.get(base.id) ?? 0
        const minimumState = operationalMinimum(stockLevel, policyEnabled)
        const minimum = minimumState.minimum
        const leadTime = Number(policyEnabled ? stockLevel?.effectiveLeadTime ?? stockLevel?.leadTime ?? 0 : stockLevel?.leadTime ?? 0)
        const averageDailyConsumption = averageDailyConsumptionByBaseId.get(base.id) ?? 0
        const daysUntilRupture = averageDailyConsumption > 0 ? Math.floor(current / averageDailyConsumption) : null
        const ruptureDate = daysUntilRupture !== null ? addDays(today, daysUntilRupture) : null
        const orderLimitDate = ruptureDate ? addDays(ruptureDate, -leadTime) : null
        return { base, current, minimum, minimumLabel: minimumState.label, leadTime, shortage: shortage(minimum, current) ?? 0, ruptureDate, orderLimitDate }
      })
      .filter((item) => item.minimum === null || (item.minimum > 0 && item.current <= item.minimum && (item.leadTime > 0 || item.shortage > 0)))
      .sort((a, b) => {
        const leadTimePriority = Number(b.leadTime > 0) - Number(a.leadTime > 0)
        return leadTimePriority || b.leadTime - a.leadTime || b.shortage - a.shortage
      })
  }, [averageDailyConsumptionByBaseId, baseProducts, cdKiosk, lots, products, today, policyEnabled])

  const allBestSellers = useMemo(() => {
    const sumItems = (reports: SalesReport[]) =>
      reports.reduce((acc, report) => {
        report.items.forEach((item) => {
          const key = item.productName || item.simulationId || item.sku
          acc.set(key, (acc.get(key) ?? 0) + Number(item.quantity || 0))
        })
        return acc
      }, new Map<string, number>())

    const current = sumItems(visibleSalesReports)
    const previous = sumItems(previousReports)
    const sameElapsedCurrent = sumItems(sameElapsedCurrentReports)
    const sameElapsedPrevious = sumItems(sameElapsedPreviousReports)
    return Array.from(current.entries())
      .map(([name, quantity]) => ({
        name,
        quantity,
        previous: previous.get(name) ?? 0,
        sameElapsedCurrent: sameElapsedCurrent.get(name) ?? quantity,
        sameElapsedPrevious: sameElapsedPrevious.get(name) ?? previous.get(name) ?? 0,
      }))
      .sort((a, b) => b.quantity - a.quantity)
  }, [previousReports, sameElapsedCurrentReports, sameElapsedPreviousReports, visibleSalesReports])

  const bestSellers = allBestSellers.slice(0, 5)
  const maxBestSellerQuantity = Math.max(...bestSellers.map((item) => item.quantity), 1)
  const maxAllBestSellerQuantity = Math.max(...allBestSellers.map((item) => item.quantity), 1)

  const currentSchedules = useMemo(
    () =>
      schedules
        .filter((schedule) => schedule.month === today.getMonth() + 1 && schedule.year === today.getFullYear())
        .sort((a, b) => {
          const left = units.find((unit) => unit.id === a.unitId)?.name ?? a.name ?? a.id
          const right = units.find((unit) => unit.id === b.unitId)?.name ?? b.name ?? b.id
          return left.localeCompare(right)
        }),
    [schedules, today, units]
  )

  useEffect(() => {
    const firstUnitId = currentSchedules[0]?.unitId ?? currentSchedules[0]?.id ?? ""
    const hasSelectedWeekly = currentSchedules.some((schedule) => (schedule.unitId ?? schedule.id) === selectedScheduleUnitId)
    const hasSelectedMonthly = currentSchedules.some((schedule) => (schedule.unitId ?? schedule.id) === monthlyScheduleUnitId)
    if (firstUnitId && (!selectedScheduleUnitId || !hasSelectedWeekly)) setSelectedScheduleUnitId(firstUnitId)
    if (firstUnitId && (!monthlyScheduleUnitId || !hasSelectedMonthly)) setMonthlyScheduleUnitId(firstUnitId)
  }, [currentSchedules, monthlyScheduleUnitId, selectedScheduleUnitId])

  const selectedWeeklySchedule = useMemo(
    () => currentSchedules.find((schedule) => (schedule.unitId ?? schedule.id) === selectedScheduleUnitId) ?? currentSchedules[0],
    [currentSchedules, selectedScheduleUnitId]
  )
  const selectedMonthlySchedule = useMemo(
    () => currentSchedules.find((schedule) => (schedule.unitId ?? schedule.id) === monthlyScheduleUnitId) ?? selectedWeeklySchedule,
    [currentSchedules, monthlyScheduleUnitId, selectedWeeklySchedule]
  )
  const { shifts: weeklyScheduleShifts, loading: weeklyScheduleLoading } = useDPShifts(selectedWeeklySchedule?.id ?? null)
  const { shifts: monthlyScheduleShifts, loading: monthlyScheduleLoading } = useDPShifts(
    scheduleModalOpen ? selectedMonthlySchedule?.id ?? null : null
  )
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 })
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const weekShifts = useMemo(
    () =>
      weeklyScheduleShifts
        .filter((shift) => {
          const date = new Date(`${shift.date}T12:00:00`)
          return isSameOrAfter(date, weekStart) && isSameOrBefore(date, weekEnd)
        })
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || "").localeCompare(b.startTime || "")),
    [weekEnd, weekStart, weeklyScheduleShifts]
  )

  const upcomingVacations = useMemo(() => {
    const validStatuses = new Set(["APPROVED", "PLANNED", "PENDING"])
    return vacations
      .filter((vacation) => vacation.recordType === "gozo" && validStatuses.has(vacation.status) && vacation.startDate)
      .map((vacation) => ({ vacation, start: new Date(`${vacation.startDate}T12:00:00`) }))
      .filter(({ start }) => isSameOrAfter(start, today) && isSameOrBefore(start, monthEnd))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 5)
  }, [monthEnd, today, vacations])

  const filteredVacations = useMemo(() => {
    return upcomingVacations.filter(({ vacation }) => vacationStatusFilter === "all" || vacation.status === vacationStatusFilter)
  }, [upcomingVacations, vacationStatusFilter])

  const financialSummary = useMemo(() => {
    const pending = (expenses ?? []).filter((expense) => expense.status === "pending")
    const overdue = pending.filter((expense) => {
      const due = toDate(expense.dueDate)
      return due && isBefore(startOfDay(due), today)
    })
    const upcoming = pending.filter((expense) => {
      const due = toDate(expense.dueDate)
      return due && isSameOrAfter(startOfDay(due), today) && isSameOrBefore(startOfDay(due), monthEnd)
    })
    const total = (items: any[]) => items.reduce((sum, expense) => sum + Number(expense.totalValue || 0), 0)
    return {
      overdue,
      upcoming,
      overdueTotal: total(overdue),
      upcomingTotal: total(upcoming),
    }
  }, [expenses, monthEnd, today])

  const visiblePaymentDetails = useMemo(
    () =>
      [...financialSummary.overdue, ...financialSummary.upcoming]
        .sort((a, b) => {
          const left = toDate(a.dueDate)?.getTime() ?? 0
          const right = toDate(b.dueDate)?.getTime() ?? 0
          return left - right
        }),
    [financialSummary]
  )

  if (!canViewManagementDashboard) {
    if (canViewCollaboratorDashboard) {
      return null
    }
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
    <div className="w-full space-y-3 pb-8 font-ds">
      <div className="flex flex-col justify-between gap-3 pb-1 md:flex-row md:items-end">
        <div className="min-w-0">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-ds-border bg-ds-accent-soft px-2.5 py-1 text-[11px] font-extrabold text-ds-accent-ink">
            <Target className="h-3 w-3" />
            Painel da gestão
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ds-ink">Painel da gestão</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-ds-ink-muted">
            Olá, {user?.username}. Organize os indicadores e atalhos mais importantes para sua rotina.
          </p>
        </div>
        <div className="hidden items-center gap-2 rounded-ds-btn border border-ds-border bg-ds-surface px-3 py-2 text-xs font-semibold text-ds-ink-muted shadow-sm sm:flex">
          <Calendar className="h-4 w-4 text-ds-ink-faint" />
          {format(today, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
        </div>
      </div>

      <ManagementDashboardBuilder firebaseUser={firebaseUser} userId={firebaseUser?.uid ?? user?.id ?? ""} userName={user?.username ?? "Usuário"} permissions={permissions}>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-6 xl:grid-cols-12">
        {(permissions.pricing.view || permissions.goals?.view || canViewTechnicalSheets(permissions)) && (
          <DashboardCard widgetId="goals-revenue" title="Metas e faturamento" description="Meta geral, projeção e metas atuais por quiosque." href="/dashboard/goals/tracking" icon={Target} hideDetailsLink>
            <div className="grid gap-3 md:grid-cols-3">
              <Metric label="Faturamento" value={compactCurrency(currentRevenue)} detail={`${visibleSalesReports.length} relatório(s) em ${formatSalesPeriod(visibleSalesReports)}`} />
              <Metric
                label="Meta geral atual"
                value={compactCurrency(currentGoals.reduce((sum, goal) => sum + (goal.targetValue || 0), 0))}
                detail={goalsLoading ? "Carregando metas..." : `${currentGoals.length} meta(s) ativa(s)`}
              />
              <Metric
                label="Projetado"
                value={compactCurrency(projectedRevenue.value)}
                detail={projectedRevenue.detail}
              />
            </div>
            {goalRows.length === 0 ? (
              <EmptyState>Nenhuma meta ativa para hoje.</EmptyState>
            ) : (
              <div className="space-y-3">
                {goalRows.slice(0, 5).map((goal) => (
                  <div key={goal.kioskId} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate font-bold text-ds-ink">{goal.name}</span>
                      <span className="whitespace-nowrap font-semibold text-ds-ink-muted">
                        {formatCurrency(goal.current)} / {formatCurrency(goal.target)}
                      </span>
                      <span className={cn("w-10 text-right text-xs font-black", goal.progress >= 0.8 ? "text-ds-ink" : "text-ds-warn")}>
                        {Math.round(goal.progress * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ds-muted">
                      <div
                        className={cn("h-full rounded-full", goal.progress >= 0.8 ? "bg-ds-accent" : "bg-ds-warn")}
                        style={{ width: `${Math.min(100, Math.round(goal.progress * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="inline-flex items-center gap-3 px-1 text-xs font-extrabold text-ds-accent-ink" onClick={() => setGoalsModalOpen(true)}>
              Ver detalhes <ArrowRight className="h-4 w-4" />
            </button>
          </DashboardCard>
        )}

        <DashboardCard
          widgetId="pending-tasks"
          title="Tarefas pendentes"
          description="Demandas em aberto, aprovações e recebimentos."
          href="/dashboard/tasks"
          icon={ListTodo}
          className="order-1"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Pendentes"
              value={tasksLoading ? "..." : numberFormatter.format(pendingTaskCount)}
              detail={`${taskNotifications.length} tarefa(s), ${pendingReceipts.length} recebimento(s)`}
            />
            <Metric
              label="Vencidas"
              value={tasksLoading ? "..." : numberFormatter.format(overdueTasks.length)}
              detail="Com prazo anterior a hoje"
            />
            <Metric
              label="Aprovações"
              value={tasksLoading ? "..." : numberFormatter.format(approvalTasks.length)}
              detail={`${dueTodayTasks.length} vencendo hoje`}
            />
          </div>
          {tasksLoading ? (
            <EmptyState>Carregando tarefas...</EmptyState>
          ) : pendingTaskCount === 0 ? (
            <EmptyState>Nenhuma tarefa pendente no momento.</EmptyState>
          ) : visiblePendingTasks.length === 0 ? (
            <EmptyState>{pendingTaskCount} demanda(s) pendente(s) em fluxos operacionais.</EmptyState>
          ) : (
            <div className="space-y-3">
              {visiblePendingTasks.map((task) => {
                const dueDate = task.dueDate ? startOfDay(new Date(task.dueDate)) : null
                const isOverdue = !!dueDate && isBefore(dueDate, today)
                return (
                  <div key={task.id} className="flex items-start justify-between gap-3 rounded-lg border border-ds-divider bg-ds-surface p-3 text-xs shadow-sm">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-ds-ink">{task.title}</p>
                      <p className="mt-0.5 text-xs font-semibold text-ds-ink-faint">{getTaskStatusLabel(task.status)}</p>
                    </div>
                    <span
                      className={cn(
                        "whitespace-nowrap rounded-full px-3 py-1 text-xs font-black",
                        isOverdue ? "bg-ds-danger-bg text-ds-danger" : "bg-ds-accent-soft text-ds-accent-ink"
                      )}
                    >
                      {dueDate ? format(dueDate, "dd/MM") : "sem prazo"}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </DashboardCard>

        {permissions.dashboard.operational && (
          <DashboardCard
            widgetId="critical-restock"
            title="Reposição crítica do CD"
            description="Itens no mínimo, priorizando lead time."
            href="/dashboard/stock/analysis/restock"
            icon={AlertTriangle}
            className="order-3"
            hideDetailsLink
          >
            {!cdKiosk ? (
              <EmptyState>Centro de distribuição não identificado nos quiosques.</EmptyState>
            ) : policyEnabled === null && policyError ? (
              <EmptyState>Política de reposição indisponível. Mínimos não verificados.</EmptyState>
            ) : criticalRestockItems.length === 0 ? (
              <EmptyState>Nenhum item crítico encontrado para {cdKiosk.name}.</EmptyState>
            ) : (
              <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
                {criticalRestockItems.map(({ base, current, minimum, minimumLabel, leadTime, ruptureDate, orderLimitDate }) => (
                  <div key={base.id} className="flex items-start justify-between gap-3 rounded-lg border border-ds-danger bg-ds-danger-bg p-3 text-xs">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-ds-ink">{base.name}</p>
                      <p className="mt-1 text-xs font-semibold text-ds-ink-faint">Atual {numberFormatter.format(current)} · mín. {minimum === null ? minimumLabel : numberFormatter.format(minimum)}</p>
                      <p className="mt-1 text-xs font-semibold text-ds-ink-faint">
                        Ruptura: <span className={cn(!ruptureDate && "text-ds-ink-faint", ruptureDate && isSameOrBefore(ruptureDate, today) && "text-ds-accent-ink")}>
                          {ruptureDate ? format(ruptureDate, "dd/MM/yyyy") : "sem consumo médio"}
                        </span>{" "}
                        · pedido até{" "}
                        {orderLimitDate ? format(orderLimitDate, "dd/MM/yyyy") : "sem data"}
                      </p>
                    </div>
                    <span className="whitespace-nowrap rounded-full bg-ds-accent-soft px-2.5 py-1 text-xs font-black text-ds-accent-ink">
                      {leadTime ? `${leadTime}d` : "sem dia(s)"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </DashboardCard>
        )}

        {(permissions.pricing.view || permissions.goals?.view || canViewTechnicalSheets(permissions)) && (
          <DashboardCard
            widgetId="best-sellers"
            title="Mercadorias mais vendidas"
            description="Mês corrente, mês anterior e mesmo período."
            href="/dashboard/stock/analysis/sales"
            icon={TrendingUp}
            className="order-4"
            hideDetailsLink
          >
            <Select value={selectedSalesKioskId} onValueChange={setSelectedSalesKioskId}>
              <SelectTrigger className="h-8 rounded-lg border-ds-border bg-ds-surface px-3 text-xs font-semibold text-ds-ink-muted">
                <SelectValue placeholder="Filtrar unidade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as unidades</SelectItem>
                {kiosks
                  .filter((kiosk) => !/centro|distribui|matriz/i.test(kiosk.name))
                  .map((kiosk) => (
                    <SelectItem key={kiosk.id} value={kiosk.id}>
                      {kiosk.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {bestSellers.length === 0 ? (
              <EmptyState>Nenhuma venda consolidada para exibir.</EmptyState>
            ) : (
              <>
                <div className="space-y-3">
                  {bestSellers.map((item, index) => {
                    const delta = item.quantity - item.previous
                    const sameElapsedDelta = item.sameElapsedCurrent - item.sameElapsedPrevious
                    return (
                      <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg border border-ds-divider bg-ds-surface p-3 shadow-sm">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black",
                              index === 0 && "bg-ds-warn-bg text-ds-warn",
                              index === 1 && "bg-ds-neutral-bg text-ds-neutral",
                              index === 2 && "bg-ds-accent-soft text-ds-accent-ink",
                              index > 2 && "bg-ds-muted text-ds-ink-faint"
                            )}
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black text-ds-ink">{item.name}</p>
                            <div className="mt-1.5 h-1.5 max-w-[180px] overflow-hidden rounded-full bg-ds-muted">
                              <div
                                className="h-full rounded-full bg-ds-accent"
                                style={{ width: `${Math.max(12, Math.round((item.quantity / maxBestSellerQuantity) * 100))}%` }}
                              />
                            </div>
                            <p className="mt-1 text-xs font-semibold text-ds-ink-faint">
                              mês ant. {numberFormatter.format(item.previous)} · período {numberFormatter.format(item.sameElapsedCurrent)} vs {numberFormatter.format(item.sameElapsedPrevious)}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-base font-black text-ds-ink">{numberFormatter.format(item.quantity)}</p>
                          <p className={cn("text-xs font-bold", delta >= 0 ? "text-ds-ok" : "text-ds-danger")}>
                            {delta >= 0 ? "+" : ""}{numberFormatter.format(delta)}
                          </p>
                          <p className={cn("text-xs font-bold", sameElapsedDelta >= 0 ? "text-ds-ok" : "text-ds-danger")}>
                            per. {sameElapsedDelta >= 0 ? "+" : ""}{numberFormatter.format(sameElapsedDelta)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            {bestSellers.length > 0 ? (
              <button type="button" className="inline-flex items-center gap-3 px-1 text-xs font-extrabold text-ds-accent-ink" onClick={() => setSalesModalOpen(true)}>
                Ver lista completa <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </DashboardCard>
        )}

        {permissions.dp?.view && (
          <DashboardCard widgetId="weekly-schedule" title="Escala da semana" description="Selecione a unidade para ver os turnos desta semana." href="/dashboard/dp/schedules" icon={Briefcase} hideDetailsLink>
            {currentSchedules.length > 0 ? (
              <Select value={selectedWeeklySchedule ? selectedWeeklySchedule.unitId ?? selectedWeeklySchedule.id : ""} onValueChange={setSelectedScheduleUnitId}>
                <SelectTrigger className="h-8 rounded-lg border-ds-border bg-ds-surface px-3 text-xs font-semibold text-ds-ink-muted">
                  <SelectValue placeholder="Selecionar unidade" />
                </SelectTrigger>
                <SelectContent>
                  {currentSchedules.map((schedule) => (
                    <SelectItem key={schedule.id} value={schedule.unitId ?? schedule.id}>
                      {units.find((unit) => unit.id === schedule.unitId)?.name ?? schedule.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {schedulesLoading && currentSchedules.length === 0 ? (
              <EmptyState>Carregando escalas...</EmptyState>
            ) : currentSchedules.length === 0 ? (
              <EmptyState>Nenhuma escala encontrada para {format(today, "MMMM/yyyy", { locale: ptBR })}.</EmptyState>
            ) : weeklyScheduleLoading ? (
              <EmptyState>Carregando turnos da semana...</EmptyState>
            ) : weekShifts.length === 0 ? (
              <EmptyState>Nenhum turno cadastrado para esta semana.</EmptyState>
            ) : (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
                {weekDates.map((date) => {
                  const dateKey = format(date, "yyyy-MM-dd")
                  const dayShifts = weekShifts.filter((shift) => shift.date === dateKey).slice(0, 3)
                  const isToday = dateKey === format(today, "yyyy-MM-dd")
                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        "min-h-[96px] rounded-lg border bg-ds-surface p-2.5 text-center shadow-sm",
                        isToday ? "border-ds-accent bg-ds-accent-soft/40" : "border-ds-divider"
                      )}
                    >
                      <p className={cn("text-xs font-black uppercase", isToday ? "text-ds-accent-ink" : "text-ds-ink-faint")}>
                        {format(date, "EEE", { locale: ptBR })}
                      </p>
                      <p className={cn("text-xs font-bold", isToday ? "text-ds-accent-ink" : "text-ds-ink-faint")}>{format(date, "dd/MM")}</p>
                      {dayShifts.length === 0 ? (
                        <p className="mt-3 rounded-md bg-ds-muted px-2 py-2 text-xs font-bold text-ds-ink-faint">FOLGA</p>
                      ) : (
                        <div className="mt-2 space-y-1.5">
                          {dayShifts.map((shift) => (
                            <div key={shift.id} className="rounded-md bg-ds-muted px-2 py-1.5">
                              <p className="truncate text-xs font-black text-ds-ink-2">{getShiftUserName(selectedWeeklySchedule, shift, users)}</p>
                              <p className="text-[10px] font-semibold text-ds-ink-faint">{getShiftLabel(shift)}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {currentSchedules.length > 0 ? (
              <button type="button" className="inline-flex items-center gap-3 px-1 text-xs font-extrabold text-ds-accent-ink" onClick={() => setScheduleModalOpen(true)}>
                Ver escala do mês <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </DashboardCard>
        )}

        {permissions.dp?.view && (
          <DashboardCard widgetId="vacation-calendar" title="Calendário de ausências" description="Férias previstas até o fim do mês." href="/dashboard/dp/ferias" icon={CalendarDays} hideDetailsLink>
            {vacationsLoading && upcomingVacations.length === 0 ? (
              <EmptyState>Carregando férias...</EmptyState>
            ) : upcomingVacations.length === 0 ? (
              <EmptyState>Nenhuma ausência de férias prevista no mês corrente.</EmptyState>
            ) : (
              <div className="space-y-3">
                {upcomingVacations.map(({ vacation, start }, index) => {
                  const employeeName = userNameById.get(vacation.userId) ?? vacation.userId
                  return (
                    <div key={vacation.id} className="flex items-center justify-between gap-3 rounded-lg border border-ds-divider bg-ds-surface p-3 text-xs shadow-sm">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black text-white",
                            index % 3 === 0 && "bg-ds-info",
                            index % 3 === 1 && "bg-ds-neutral",
                            index % 3 === 2 && "bg-ds-accent"
                          )}
                        >
                          {getInitials(employeeName)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-ds-ink">{employeeName}</p>
                          <p className="text-xs font-semibold text-ds-ink-faint">
                            {format(start, "dd/MM", { locale: ptBR })} a {vacation.endDate ? format(new Date(`${vacation.endDate}T12:00:00`), "dd/MM", { locale: ptBR }) : "sem fim"}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-xs font-bold",
                          vacation.status === "APPROVED" && "border-ds-ok bg-ds-ok-bg text-ds-ok",
                          vacation.status === "PLANNED" && "border-ds-info bg-ds-info-bg text-ds-info",
                          vacation.status === "PENDING" && "border-ds-warn bg-ds-warn-bg text-ds-warn"
                        )}
                      >
                        {getVacationStatusLabel(vacation.status)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" className="inline-flex items-center gap-3 px-1 text-xs font-extrabold text-ds-accent-ink" onClick={() => setVacationsModalOpen(true)}>
              Ver detalhes <ArrowRight className="h-4 w-4" />
            </button>
          </DashboardCard>
        )}

        {permissions.financial?.view && (
          <DashboardCard
            widgetId="pending-payments"
            title="Pagamentos vencidos e a vencer"
            description="Todos os vencidos e próximos do mês corrente."
            href="/dashboard/financial/expenses"
            icon={CircleDollarSign}
            className="order-6"
            hideDetailsLink
          >
            {expensesLoading ? (
              <EmptyState>Carregando pagamentos...</EmptyState>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-ds-danger bg-ds-danger-bg p-3">
                  <p className="text-xs font-black uppercase tracking-wide text-ds-accent-ink">Vencidos</p>
                  <p className="mt-1 text-xl font-black text-ds-danger">{formatCurrency(financialSummary.overdueTotal)}</p>
                  <p className="mt-1 text-xs font-semibold text-ds-accent-ink">{financialSummary.overdue.length} pagamento(s)</p>
                </div>
                <div className="rounded-lg border border-ds-divider bg-ds-surface p-3 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-wide text-ds-ink-muted">A vencer no mês</p>
                  <p className="mt-1 text-xl font-black text-ds-ink">{formatCurrency(financialSummary.upcomingTotal)}</p>
                  <p className="mt-1 text-xs font-semibold text-ds-ink-faint">{financialSummary.upcoming.length} pagamento(s)</p>
                </div>
              </div>
            )}
            {!expensesLoading ? (
              <button type="button" className="inline-flex items-center gap-3 px-1 text-xs font-extrabold text-ds-accent-ink" onClick={() => setPaymentsModalOpen(true)}>
                Detalhar pagamentos <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </DashboardCard>
        )}

        {permissions.financial?.view && <ModuleShortcutCard widgetId="financial-shortcuts" title="Central financeira" description="Acesso rápido aos principais fluxos financeiros." href="/dashboard/financial" icon={Wallet} links={[{ label: "Fluxo de caixa", href: "/dashboard/financial/cash-flow" }, { label: "Despesas", href: "/dashboard/financial/expenses" }, { label: "Conciliação", href: "/dashboard/financial/sales-reconciliation" }]} />}
        {permissions.stock.view && <ModuleShortcutCard widgetId="stock-shortcuts" title="Central de estoque" description="Controle, compras e análises do estoque." href="/dashboard/stock" icon={Boxes} links={[{ label: "Controle de estoque", href: "/dashboard/stock/inventory-control" }, { label: "Compras", href: "/dashboard/stock/purchasing" }, { label: "Análises", href: "/dashboard/stock/analysis" }]} />}
        {permissions.dp.view && <ModuleShortcutCard widgetId="people-shortcuts" title="Central de pessoas" description="Equipe, escalas, férias e documentos." href="/dashboard/dp" icon={UsersRound} links={[{ label: "Colaboradores", href: "/dashboard/dp/collaborators" }, { label: "Escalas", href: "/dashboard/dp/schedules" }, { label: "Férias", href: "/dashboard/dp/ferias" }]} />}
        {permissions.dashboard.operational && <ModuleShortcutCard widgetId="operations-shortcuts" title="Central de operações" description="Tarefas, formulários e rotinas operacionais." href="/dashboard/operations" icon={Workflow} links={[{ label: "Tarefas", href: "/dashboard/tasks" }, { label: "Formulários", href: "/dashboard/forms" }, { label: "Operações", href: "/dashboard/operations" }]} />}
        {permissions.settings.viewAiCosts && <ModuleShortcutCard widgetId="ai-costs-shortcuts" title="IA e infraestrutura" description="Custos, limites e alertas dos serviços." href="/dashboard/settings" icon={Cpu} links={[{ label: "Créditos GPT", href: "/dashboard/settings" }, { label: "Custo Google Cloud", href: "/dashboard/settings" }, { label: "Alertas", href: "/dashboard/settings" }]} />}
      </div>
      </ManagementDashboardBuilder>

      <Dialog open={goalsModalOpen} onOpenChange={setGoalsModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-ds-modal border border-ds-border bg-ds-surface p-0 shadow-ds-modal sm:max-w-3xl">
          <DialogHeader>
            <div className="px-6 pt-6">
              <div className="mb-2 inline-flex rounded-full bg-ds-accent-soft px-3 py-1 text-xs font-black text-ds-accent-ink">Detalhe das metas</div>
              <DialogTitle className="text-2xl font-black text-ds-ink">Metas e faturamento</DialogTitle>
              <DialogDescription className="text-base font-semibold text-ds-ink-faint">Progresso atual por quiosque e consolidado geral.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="border-t border-ds-divider p-6">
            <div className="mb-6 grid gap-3 md:grid-cols-3">
              <Metric label="Faturamento" value={compactCurrency(currentRevenue)} detail={formatSalesPeriod(visibleSalesReports)} />
              <Metric label="Meta geral atual" value={compactCurrency(currentGoals.reduce((sum, goal) => sum + (goal.targetValue || 0), 0))} detail={`${currentGoals.length} meta(s) ativa(s)`} />
              <Metric label="Projetado" value={compactCurrency(projectedRevenue.value)} detail={projectedRevenue.detail} />
            </div>
            <div className="space-y-5">
              {goalRows.map((goal) => (
                <div key={goal.kioskId} className="space-y-2 rounded-xl border border-ds-divider bg-ds-surface p-4 shadow-sm">
                  <div className="grid grid-cols-[1fr_auto_48px] items-center gap-4 text-sm">
                    <span className="truncate text-base font-black text-ds-ink">{goal.name}</span>
                    <span className="font-semibold text-ds-ink-muted">{formatCurrency(goal.current)} / {formatCurrency(goal.target)}</span>
                    <span className={cn("text-right font-black", goal.progress >= 0.8 ? "text-ds-ink" : "text-ds-warn")}>{Math.round(goal.progress * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ds-muted">
                    <div className={cn("h-full rounded-full", goal.progress >= 0.8 ? "bg-ds-accent" : "bg-ds-warn")} style={{ width: `${Math.min(100, Math.round(goal.progress * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={salesModalOpen} onOpenChange={setSalesModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-ds-modal border border-ds-border bg-ds-surface p-0 shadow-ds-modal sm:max-w-3xl">
          <DialogHeader>
            <div className="px-6 pt-6">
              <div className="mb-2 inline-flex rounded-full bg-ds-accent-soft px-3 py-1 text-xs font-black text-ds-accent-ink">Ranking completo</div>
              <DialogTitle className="text-2xl font-black text-ds-ink">Mercadorias mais vendidas</DialogTitle>
              <DialogDescription className="text-base font-semibold text-ds-ink-faint">
                {allBestSellers.length} produtos · {formatSalesPeriod(visibleSalesReports)} vs mês anterior
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="border-t border-ds-divider p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <p className="text-sm font-semibold text-ds-ink-faint">
                {allBestSellers.length} produtos · {formatSalesPeriod(visibleSalesReports)}
              </p>
              <Select value={selectedSalesKioskId} onValueChange={setSelectedSalesKioskId}>
                <SelectTrigger className="h-10 w-[220px] rounded-lg border-ds-border bg-ds-surface px-4 font-semibold text-ds-ink-muted">
                  <SelectValue placeholder="Filtrar unidade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as unidades</SelectItem>
                  {kiosks
                    .filter((kiosk) => !/centro|distribui|matriz/i.test(kiosk.name))
                    .map((kiosk) => (
                      <SelectItem key={kiosk.id} value={kiosk.id}>
                        {kiosk.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-[48px_1fr_80px_80px_80px_140px] border-b border-ds-divider px-3 pb-3 text-xs font-black uppercase tracking-wide text-ds-ink-faint">
              <span>#</span>
              <span>Produto</span>
              <span className="text-right">Qtd</span>
              <span className="text-right">Ant.</span>
              <span className="text-right">Delta</span>
              <span>Proporção</span>
            </div>
            <div className="divide-y divide-ds-divider">
              {allBestSellers.map((item, index) => {
                const delta = item.quantity - item.previous
                return (
                  <div key={item.name} className="grid grid-cols-[48px_1fr_80px_80px_80px_140px] items-center px-3 py-4 text-sm">
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-black",
                        index === 0 && "bg-ds-warn-bg text-ds-warn",
                        index === 1 && "bg-ds-neutral-bg text-ds-neutral",
                        index === 2 && "bg-ds-accent-soft text-ds-accent-ink",
                        index > 2 && "bg-ds-muted text-ds-ink-faint"
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="truncate font-black text-ds-ink">{item.name}</span>
                    <span className="text-right font-black text-ds-ink">{numberFormatter.format(item.quantity)}</span>
                    <span className="text-right font-semibold text-ds-ink-faint">{numberFormatter.format(item.previous)}</span>
                    <span className={cn("text-right font-black", delta >= 0 ? "text-ds-ok" : "text-ds-danger")}>
                      {delta >= 0 ? "+" : ""}{numberFormatter.format(delta)}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-ds-muted">
                      <span
                        className="block h-full rounded-full bg-ds-accent"
                        style={{ width: `${Math.max(6, Math.round((item.quantity / maxAllBestSellerQuantity) * 100))}%` }}
                      />
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentsModalOpen} onOpenChange={setPaymentsModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-ds-modal border border-ds-border bg-ds-surface shadow-ds-modal sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pagamentos vencidos e a vencer</DialogTitle>
            <DialogDescription>Vencidos em aberto e vencimentos restantes do mês corrente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {visiblePaymentDetails.length === 0 ? (
              <EmptyState>Nenhum pagamento em aberto para o critério atual.</EmptyState>
            ) : (
              visiblePaymentDetails.map((expense) => {
                const due = toDate(expense.dueDate)
                const overdue = due ? isBefore(startOfDay(due), today) : false
                return (
                  <div key={expense.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{expense.description || expense.supplier || "Pagamento sem descrição"}</p>
                      <p className="text-xs text-muted-foreground">{expense.supplier || "Fornecedor não informado"}</p>
                    </div>
                    <p className={cn("font-semibold", overdue && "text-ds-danger")}>{formatCurrency(Number(expense.totalValue || 0))}</p>
                    <p className="text-xs text-muted-foreground">{due ? format(due, "dd/MM/yyyy") : "sem vencimento"}</p>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vacationsModalOpen} onOpenChange={setVacationsModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-ds-modal border border-ds-border bg-ds-surface p-0 shadow-ds-modal sm:max-w-3xl">
          <DialogHeader>
            <div className="px-6 pt-6">
              <div className="mb-2 inline-flex rounded-full bg-ds-accent-soft px-3 py-1 text-xs font-black text-ds-accent-ink">Calendário de ausências</div>
              <DialogTitle className="text-2xl font-black text-ds-ink">Férias do mês</DialogTitle>
              <DialogDescription className="text-base font-semibold text-ds-ink-faint">Ausências previstas até o fim do mês corrente.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="border-t border-ds-divider p-6">
            <div className="mb-5 flex flex-wrap gap-2">
              {[
                ["all", "Todos"],
                ["APPROVED", "Aprovadas"],
                ["PLANNED", "Planejadas"],
                ["PENDING", "Pendentes"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-black",
                    vacationStatusFilter === value ? "border-ds-accent bg-ds-accent text-white" : "border-ds-divider bg-ds-surface text-ds-ink-muted"
                  )}
                  onClick={() => setVacationStatusFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredVacations.length === 0 ? (
              <EmptyState>Nenhuma ausência encontrada para o filtro.</EmptyState>
            ) : (
              <div className="space-y-3">
                {filteredVacations.map(({ vacation, start }, index) => {
                  const employeeName = userNameById.get(vacation.userId) ?? vacation.userId
                  return (
                    <div key={vacation.id} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 rounded-xl border border-ds-divider bg-ds-surface p-4 shadow-sm">
                      <div
                        className={cn(
                          "flex h-12 w-12 items-center justify-center rounded-full text-sm font-black text-white",
                          index % 5 === 0 && "bg-ds-info",
                          index % 5 === 1 && "bg-ds-neutral",
                          index % 5 === 2 && "bg-ds-accent",
                          index % 5 === 3 && "bg-ds-warn",
                          index % 5 === 4 && "bg-ds-ok"
                        )}
                      >
                        {getInitials(employeeName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-base font-black text-ds-ink">{employeeName}</p>
                        <p className="text-sm font-semibold text-ds-ink-faint">
                          {format(start, "dd/MM", { locale: ptBR })} a {vacation.endDate ? format(new Date(`${vacation.endDate}T12:00:00`), "dd/MM", { locale: ptBR }) : "sem fim"}
                        </p>
                      </div>
                      <p className="hidden text-sm font-semibold text-ds-ink-faint sm:block">{vacation.days} dia(s)</p>
                      <span
                        className={cn(
                          "rounded-lg border px-3 py-1 text-sm font-bold",
                          vacation.status === "APPROVED" && "border-ds-ok bg-ds-ok-bg text-ds-ok",
                          vacation.status === "PLANNED" && "border-ds-info bg-ds-info-bg text-ds-info",
                          vacation.status === "PENDING" && "border-ds-warn bg-ds-warn-bg text-ds-warn"
                        )}
                      >
                        {getVacationStatusLabel(vacation.status)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-ds-modal border border-ds-border bg-ds-surface p-0 shadow-ds-modal sm:max-w-4xl">
          <DialogHeader>
            <div className="px-6 pt-6">
              <div className="mb-2 inline-flex rounded-full bg-ds-accent-soft px-3 py-1 text-xs font-black text-ds-accent-ink">
                {selectedMonthlySchedule ? units.find((unit) => unit.id === selectedMonthlySchedule.unitId)?.name ?? selectedMonthlySchedule.name : "Unidade"}
              </div>
              <DialogTitle className="text-2xl font-black text-ds-ink">Escala do mês</DialogTitle>
              <DialogDescription className="text-base font-semibold text-ds-ink-faint">Todos os turnos cadastrados · {format(today, "MMMM yyyy", { locale: ptBR })}</DialogDescription>
            </div>
          </DialogHeader>
          <div className="border-t border-ds-divider p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <p className="text-sm font-semibold text-ds-ink-faint">
                {new Set(monthlyScheduleShifts.map((shift) => shift.date)).size} dias com turnos · {format(today, "MMMM yyyy", { locale: ptBR })}
              </p>
              {currentSchedules.length > 0 ? (
                <Select value={selectedMonthlySchedule ? selectedMonthlySchedule.unitId ?? selectedMonthlySchedule.id : ""} onValueChange={setMonthlyScheduleUnitId}>
                  <SelectTrigger className="h-10 w-[220px] rounded-lg border-ds-border bg-ds-surface px-4 font-semibold text-ds-ink-muted">
                    <SelectValue placeholder="Selecionar unidade" />
                  </SelectTrigger>
                  <SelectContent>
                    {currentSchedules.map((schedule) => (
                      <SelectItem key={schedule.id} value={schedule.unitId ?? schedule.id}>
                        {units.find((unit) => unit.id === schedule.unitId)?.name ?? schedule.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            {monthlyScheduleLoading ? (
              <EmptyState>Carregando escala do mês...</EmptyState>
            ) : monthlyScheduleShifts.length === 0 ? (
              <EmptyState>Nenhum turno cadastrado para esta unidade.</EmptyState>
            ) : (
              <div className="space-y-4">
                {Array.from(new Set(monthlyScheduleShifts.map((shift) => shift.date)))
                  .sort()
                  .map((dateKey) => {
                    const dayShifts = monthlyScheduleShifts
                      .filter((shift) => shift.date === dateKey)
                      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))
                    const date = new Date(`${dateKey}T12:00:00`)
                    return (
                      <div key={dateKey} className="grid grid-cols-[72px_1fr] gap-5 rounded-xl border border-ds-divider bg-ds-surface p-4 shadow-sm">
                        <div className="text-center">
                          <p className="text-xs font-black uppercase text-ds-ink-faint">{format(date, "EEE", { locale: ptBR })}</p>
                          <p className="text-2xl font-black text-ds-ink">{format(date, "dd")}</p>
                          <p className="text-sm font-bold text-ds-ink-faint">{format(date, "MM")}</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {dayShifts.map((shift) => (
                            <div key={shift.id} className="flex min-w-[140px] items-center justify-between gap-3 rounded-lg border border-ds-divider bg-ds-muted px-4 py-2">
                              <span className="truncate text-sm font-black text-ds-ink">{getShiftUserName(selectedMonthlySchedule, shift, users)}</span>
                              <span className="text-xs font-bold text-ds-ink-faint">{getShiftLabel(shift)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <GoalsProvider>
      <ManagementDashboard />
    </GoalsProvider>
  )
}
