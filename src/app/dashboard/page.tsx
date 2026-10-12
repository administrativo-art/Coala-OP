"use client"

import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { addDays, endOfMonth, endOfWeek, format, isBefore, startOfDay, startOfWeek } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
  Calendar,
  Target,
} from "lucide-react"
import { useRouter } from "next/navigation"

import { PageHero } from "@/components/patterns/page-hero"
import { GoalsProvider } from "@/components/goals-provider"
import { useDP } from "@/components/dp-context"
import { GlassCard } from "@/components/ui/glass-card"
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { ManagementDashboardBuilder } from "@/features/management-dashboard/builder-context"
import { GoalsWidget } from "@/features/management-dashboard/widgets/goals-widget"
import { HubWidget, type HubAttention, type HubKpi, type HubLink } from "@/features/management-dashboard/widgets/hub-widget"
import { widgetIcons } from "@/features/management-dashboard/widgets/icons"
import { PaymentsWidget, type PaymentRow } from "@/features/management-dashboard/widgets/payments-widget"
import { RestockWidget, type RestockItem } from "@/features/management-dashboard/widgets/restock-widget"
import { SalesWidget } from "@/features/management-dashboard/widgets/sales-widget"
import { ScheduleWidget, type ScheduleDay } from "@/features/management-dashboard/widgets/schedule-widget"
import { TasksWidget, type TaskItem } from "@/features/management-dashboard/widgets/tasks-widget"
import { VacationsWidget, type VacationItem } from "@/features/management-dashboard/widgets/vacations-widget"
import { MANAGEMENT_WIDGET_BY_ID } from "@/features/management-dashboard/catalog"
import type { ManagementWidgetId } from "@/features/management-dashboard/types"
import { MonthFilter } from "@/features/management-dashboard/widgets/month-filter"
import { listRecentMonths, monthKeyOf, monthStartOf } from "@/features/management-dashboard/widgets/month-range"
import { cn } from "@/lib/utils"
import type { DPSchedule, DPShift, GoalPeriodDoc, Kiosk, SalesReport, User } from "@/types"

const numberFormatter = new Intl.NumberFormat("pt-BR")
function isSameOrBefore(left: Date, right: Date) {
  return left.getTime() <= right.getTime()
}

function isSameOrAfter(left: Date, right: Date) {
  return left.getTime() >= right.getTime()
}

/** Metas que cobrem algum dia do mês (ativas ou já encerradas; canceladas ficam de fora). */
function getGoalPeriodsForMonth(periods: GoalPeriodDoc[], monthStart: Date) {
  const monthEndDate = endOfMonth(monthStart)
  return periods.filter((period) => {
    if (period.status === "cancelled") return false
    const start = toDate(period.startDate)
    const end = toDate(period.endDate)
    return !!start && !!end && isSameOrBefore(startOfDay(start), monthEndDate) && isSameOrAfter(startOfDay(end), monthStart)
  })
}

function getKioskName(kiosks: Kiosk[], kioskId: string) {
  return kiosks.find((kiosk) => kiosk.id === kioskId)?.name ?? kioskId
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
  /** Cada widget só aparece para quem tem acesso ao módulo de origem (regra única no catálogo). */
  const canShowWidget = (id: ManagementWidgetId) => MANAGEMENT_WIDGET_BY_ID.get(id)?.canView(permissions) ?? false

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
  const [salesMonth, setSalesMonth] = useState<string | null>(null)
  const [goalsMonth, setGoalsMonth] = useState<string | null>(null)
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

  const salesFilteredByUnit = useMemo(
    () => salesReports.filter((report) => selectedSalesKioskId === "all" || report.kioskId === selectedSalesKioskId),
    [salesReports, selectedSalesKioskId]
  )

  const currentMonthKey = monthKeyOf(today)
  const monthChoices = useMemo(() => listRecentMonths(today, 13), [today])

  const currentReports = useMemo(
    () => salesFilteredByUnit.filter((report) => monthKeyOf(new Date(report.year, report.month - 1, 1)) === (salesMonth ?? currentMonthKey)),
    [salesFilteredByUnit, salesMonth, currentMonthKey]
  )

  const latestSalesPeriod = salesFilteredByUnit[0] ? { month: salesFilteredByUnit[0].month, year: salesFilteredByUnit[0].year } : null
  const visibleSalesReports = useMemo(() => {
    // Sem escolha do usuário e sem vendas no mês atual, mostra o último mês com dados.
    if (currentReports.length > 0 || salesMonth !== null || !latestSalesPeriod) return currentReports
    return salesFilteredByUnit.filter((report) => report.month === latestSalesPeriod.month && report.year === latestSalesPeriod.year)
  }, [currentReports, latestSalesPeriod, salesFilteredByUnit, salesMonth])

  const salesMonthValue = salesMonth ?? (visibleSalesReports[0] ? monthKeyOf(new Date(visibleSalesReports[0].year, visibleSalesReports[0].month - 1, 1)) : currentMonthKey)
  const salesElapsedDay = salesMonthValue === currentMonthKey ? today.getDate() : 31

  const previousReports = useMemo(() => {
    const previousDate = new Date(monthStartOf(salesMonthValue).getFullYear(), monthStartOf(salesMonthValue).getMonth() - 1, 1)
    return salesFilteredByUnit.filter((report) => report.month === previousDate.getMonth() + 1 && report.year === previousDate.getFullYear())
  }, [salesFilteredByUnit, salesMonthValue])

  const sameElapsedCurrentReports = useMemo(
    () => visibleSalesReports.filter((report) => reportBelongsToSameElapsedPeriod(report, salesElapsedDay)),
    [salesElapsedDay, visibleSalesReports]
  )

  const sameElapsedPreviousReports = useMemo(
    () => previousReports.filter((report) => reportBelongsToSameElapsedPeriod(report, salesElapsedDay)),
    [previousReports, salesElapsedDay]
  )

  // Faturamento e metas: mês próprio, independente da unidade escolhida em "mais vendidas".
  const goalsMonthValue = goalsMonth ?? currentMonthKey
  const goalsMonthStart = monthStartOf(goalsMonthValue)
  const goalsReports = useMemo(
    () => salesReports.filter((report) => monthKeyOf(new Date(report.year, report.month - 1, 1)) === goalsMonthValue),
    [salesReports, goalsMonthValue]
  )

  const currentRevenue = useMemo(
    () => goalsReports.reduce((sum, report) => sum + getSalesReportRevenue(report), 0),
    [goalsReports]
  )

  const projectedRevenue = useMemo(
    () => getProjectedRevenue(goalsReports, today),
    [today, goalsReports]
  )

  const currentGoals = useMemo(() => getGoalPeriodsForMonth(periods, goalsMonthStart), [periods, goalsMonthValue]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const daysInMonth = monthEnd.getDate()
  const monthLabel = format(today, "MMMM 'de' yyyy", { locale: ptBR })
  const goalsMonthLabel = format(goalsMonthStart, "MMMM 'de' yyyy", { locale: ptBR })
  const monthProgress = goalsMonthValue === currentMonthKey ? today.getDate() / daysInMonth : 1
  const dayDiff = (date: Date) => Math.round((startOfDay(date).getTime() - today.getTime()) / 86_400_000)

  const toTaskItem = (task: (typeof pendingNewTasks)[number]): TaskItem => {
    const dueDate = task.dueDate ? startOfDay(new Date(task.dueDate)) : null
    return {
      id: task.id,
      title: task.title,
      statusLabel: getTaskStatusLabel(task.status),
      dueLabel: dueDate ? format(dueDate, "dd/MM") : "sem prazo",
      overdue: !!dueDate && isBefore(dueDate, today),
    }
  }
  const dueTime = (task: (typeof pendingNewTasks)[number]) => (task.dueDate ? new Date(task.dueDate).getTime() : Number.POSITIVE_INFINITY)
  const taskItems = [...pendingNewTasks].sort((a, b) => dueTime(a) - dueTime(b)).map(toTaskItem)
  const approvalTaskItems = approvalTasks.map(toTaskItem)
  const overdueTaskItems = overdueTasks.map(toTaskItem)

  const restockItems: RestockItem[] = criticalRestockItems.map(({ base, current, minimum, minimumLabel, leadTime, ruptureDate, orderLimitDate }) => ({
    id: base.id,
    name: base.name,
    current,
    minimumLabel: minimum === null ? minimumLabel : numberFormatter.format(minimum),
    leadTime,
    daysUntilRupture: ruptureDate ? Math.max(0, dayDiff(ruptureDate)) : null,
    ruptureLabel: ruptureDate ? format(ruptureDate, "dd/MM") : "sem consumo médio",
    orderLimitLabel: orderLimitDate ? format(orderLimitDate, "dd/MM") : "sem data",
    coverage: minimum && minimum > 0 ? Math.min(1, current / minimum) : null,
  }))
  const restockUnavailable = !cdKiosk
    ? "Centro de distribuição não identificado nos quiosques."
    : policyEnabled === null && policyError
      ? "Política de reposição indisponível. Mínimos não verificados."
      : null

  const salesTotalQuantity = allBestSellers.reduce((sum, item) => sum + item.quantity, 0)

  const scheduleDays: ScheduleDay[] = weekDates.map((date) => {
    const dateKey = format(date, "yyyy-MM-dd")
    return {
      key: dateKey,
      weekday: format(date, "EEE", { locale: ptBR }),
      dateLabel: format(date, "dd/MM"),
      isToday: dateKey === format(today, "yyyy-MM-dd"),
      shifts: weekShifts
        .filter((shift) => shift.date === dateKey && shift.type !== "day_off")
        .map((shift) => {
          const name = getShiftUserName(selectedWeeklySchedule, shift, users)
          return { id: shift.id, name, time: getShiftLabel(shift), initials: getInitials(name) }
        }),
    }
  })
  const scheduleEmptyMessage =
    schedulesLoading && currentSchedules.length === 0
      ? "Carregando escalas..."
      : currentSchedules.length === 0
        ? `Nenhuma escala encontrada para ${format(today, "MMMM/yyyy", { locale: ptBR })}.`
        : weeklyScheduleLoading
          ? "Carregando turnos da semana..."
          : weekShifts.length === 0
            ? "Nenhum turno cadastrado para esta semana."
            : null
  const scheduleUnitLabel = selectedWeeklySchedule
    ? units.find((unit) => unit.id === selectedWeeklySchedule.unitId)?.name ?? selectedWeeklySchedule.name ?? ""
    : ""

  const vacationItems: VacationItem[] = upcomingVacations.map(({ vacation, start }) => {
    const name = userNameById.get(vacation.userId) ?? vacation.userId
    const end = vacation.endDate ? new Date(`${vacation.endDate}T12:00:00`) : null
    const endDay = end ? (isSameOrAfter(end, monthEnd) ? daysInMonth : end.getDate()) : start.getDate()
    return {
      id: vacation.id,
      name,
      initials: getInitials(name),
      rangeLabel: `${format(start, "dd/MM")} a ${end ? format(end, "dd/MM") : "sem fim"}`,
      status: vacation.status,
      statusLabel: getVacationStatusLabel(vacation.status),
      startDay: start.getDate(),
      endDay: Math.max(endDay, start.getDate()),
    }
  })

  const paymentRows: PaymentRow[] = visiblePaymentDetails.map((expense) => {
    const due = toDate(expense.dueDate)
    const diff = due ? dayDiff(due) : 0
    const overdue = !!due && diff < 0
    return {
      id: expense.id,
      description: expense.description || expense.supplier || "Pagamento sem descrição",
      dueDay: due ? format(due, "dd") : "--",
      dueLabel: due ? format(due, "MMM", { locale: ptBR }) : "",
      value: formatCurrency(Number(expense.totalValue || 0)),
      overdue,
      daysLabel: !due ? "sem vencimento" : overdue ? `Venceu há ${Math.abs(diff)} dia(s)` : diff === 0 ? "Vence hoje" : `Vence em ${diff} dia(s)`,
    }
  })

  const pendingVacationCount = upcomingVacations.filter(({ vacation }) => vacation.status === "PENDING").length
  const hubLink = (label: string, description: string, href: string, icon: HubLink["icon"], tone: HubLink["tone"], badge?: number | null): HubLink => ({ label, description, href, icon, tone, badge })
  const financeHub = {
    links: [
      hubLink("Despesas", "Lançar e acompanhar vencimentos", "/dashboard/financial/expenses", widgetIcons.expenses, "danger", financialSummary.overdue.length + financialSummary.upcoming.length),
      hubLink("Fluxo de caixa", "Entradas, saídas e recebíveis", "/dashboard/financial/cash-flow", widgetIcons.cash, "ok"),
      hubLink("Conciliação", "Vendas, recebimentos e extratos", "/dashboard/financial/sales-reconciliation", widgetIcons.reconciliation, "warn"),
      hubLink("DRE", "Resultado por centro", "/dashboard/financial/dre", widgetIcons.income, "info"),
      hubLink("Fechamento de caixa", "Conferência diária", "/dashboard/financial/cash-closures", widgetIcons.wallet, "accent"),
      hubLink("Depósitos", "Contagem e envio ao banco", "/dashboard/financial/cash-deposits", widgetIcons.financeHub, "ok"),
      hubLink("Extratos", "Importar e auditar contas", "/dashboard/financial/reconciliation/bank-statements", widgetIcons.statements, "accent"),
      hubLink("Faturas de cartão", "Cartões corporativos", "/dashboard/financial/reconciliation/card-statements", widgetIcons.payments, "info"),
    ],
    kpis: [
      { label: "Vencidos", value: formatCurrency(financialSummary.overdueTotal), note: `${financialSummary.overdue.length} pagamento(s)`, tone: financialSummary.overdue.length > 0 ? "danger" : "muted", icon: widgetIcons.alerts },
      { label: "A vencer no mês", value: formatCurrency(financialSummary.upcomingTotal), note: `${financialSummary.upcoming.length} pagamento(s)`, tone: "warn", icon: widgetIcons.workday },
      { label: "Em aberto", value: formatCurrency(financialSummary.overdueTotal + financialSummary.upcomingTotal), icon: widgetIcons.wallet },
    ] satisfies HubKpi[],
    attention: [
      ...(financialSummary.overdue.length > 0 ? [{ title: "Pagamentos vencidos", text: `${financialSummary.overdue.length} · ${formatCurrency(financialSummary.overdueTotal)}`, href: "/dashboard/financial/expenses", tone: "danger", icon: widgetIcons.alerts } satisfies HubAttention] : []),
      ...(financialSummary.upcoming.length > 0 ? [{ title: "Vencem neste mês", text: `${financialSummary.upcoming.length} · ${formatCurrency(financialSummary.upcomingTotal)}`, href: "/dashboard/financial/expenses", tone: "warn", icon: widgetIcons.workday } satisfies HubAttention] : []),
    ],
    status: expensesLoading ? null : financialSummary.overdue.length > 0 ? { tone: "danger" as const, label: `${financialSummary.overdue.length} vencido(s)` } : { tone: "ok" as const, label: "Sem vencidos" },
  }
  const canSeeRestock = permissions.dashboard.operational && permissions.stock.analysis.restock
  const stockHub = {
    links: [
      hubLink("Estoque", "Saldos, lotes e mínimos", "/dashboard/stock/inventory-control", widgetIcons.inventory, "warn", canSeeRestock ? restockItems.length : null),
      hubLink("Compras", "Pedidos e recebimentos", "/dashboard/purchasing", widgetIcons.purchasing, "info"),
      hubLink("Contagem", "Sessões e divergências", "/dashboard/stock/count", widgetIcons.counting, "ok"),
      hubLink("Movimentações", "Entradas, saídas e transferências", "/dashboard/stock/analysis/movement-analysis", widgetIcons.movements, "accent"),
      hubLink("Análises", "Reposição, consumo e vendas", "/dashboard/stock/analysis", widgetIcons.analysis, "info"),
      hubLink("Avarias", "Devoluções e perdas", "/dashboard/stock/returns", widgetIcons.returns, "danger"),
      hubLink("Uniformes", "Controle de uniformes", "/dashboard/stock/uniforms", widgetIcons.collaborators, "neutral"),
      hubLink("Reposição", "Itens abaixo do mínimo", "/dashboard/stock/analysis/restock", widgetIcons.restock, "warn"),
    ],
    kpis: [
      { label: "Itens críticos", value: canSeeRestock ? String(restockItems.length) : "—", note: "no CD", tone: restockItems.length > 0 ? "warn" : "muted", icon: widgetIcons.restock },
      { label: "Ruptura hoje", value: canSeeRestock ? String(restockItems.filter((item) => item.daysUntilRupture === 0).length) : "—", tone: "danger", icon: widgetIcons.alerts },
    ] satisfies HubKpi[],
    attention: canSeeRestock && restockItems.length > 0
      ? [{ title: `${restockItems.length} item(ns) no mínimo`, text: "Veja a reposição crítica do CD", href: "/dashboard/stock/analysis/restock", tone: "warn", icon: widgetIcons.restock } satisfies HubAttention]
      : [],
    status: canSeeRestock ? (restockItems.length > 0 ? { tone: "warn" as const, label: `${restockItems.length} abaixo do mínimo` } : { tone: "ok" as const, label: "Estoque em dia" }) : null,
  }
  const peopleHub = {
    links: [
      hubLink("Colaboradores", "Cadastro e contratos", "/dashboard/dp/collaborators", widgetIcons.collaborators, "info"),
      hubLink("Escalas", "Turnos e folgas", "/dashboard/dp/schedules", widgetIcons.schedules, "accent"),
      hubLink("Férias", "Planejamento e aprovações", "/dashboard/dp/ferias", widgetIcons.vacation, "warn", pendingVacationCount),
      hubLink("Documentos", "Modelos e assinaturas", "/dashboard/documents", widgetIcons.documents, "danger"),
      hubLink("Vagas", "Recrutamento e integração", "/dashboard/hr/recruitment", widgetIcons.admissions, "ok"),
      hubLink("Desligamentos", "Processo e provisões", "/dashboard/dp/terminations", widgetIcons.termination, "neutral"),
      hubLink("Organograma", "Estrutura da equipe", "/dashboard/hr/org-chart", widgetIcons.places, "info"),
      hubLink("Painel DP", "Visão geral do departamento", "/dashboard/dp", widgetIcons.peopleHub, "accent"),
    ],
    kpis: [
      { label: "Ausências no mês", value: String(upcomingVacations.length), icon: widgetIcons.absences, tone: "info" },
      { label: "Férias pendentes", value: String(pendingVacationCount), tone: pendingVacationCount > 0 ? "warn" : "muted", icon: widgetIcons.workday },
      { label: "Escalas do mês", value: String(currentSchedules.length), icon: widgetIcons.schedules },
    ] satisfies HubKpi[],
    attention: pendingVacationCount > 0
      ? [{ title: "Férias aguardando aprovação", text: `${pendingVacationCount} solicitação(ões)`, href: "/dashboard/dp/ferias", tone: "warn", icon: widgetIcons.vacation } satisfies HubAttention]
      : [],
    status: pendingVacationCount > 0 ? { tone: "warn" as const, label: `${pendingVacationCount} aprovação(ões)` } : null,
  }
  const operationsHub = {
    links: [
      hubLink("Tarefas", "Demandas e prazos", "/dashboard/tasks", widgetIcons.tasks, "info", pendingTaskCount),
      hubLink("Formulários", "Modelos e respostas", "/dashboard/forms", widgetIcons.forms, "accent"),
      hubLink("Processos", "Fluxos com etapas", "/dashboard/processes", widgetIcons.processes, "danger"),
      hubLink("Meus formulários", "O que falta responder", "/dashboard/forms/mine", widgetIcons.checklists, "ok"),
      hubLink("Painel de operações", "Rotina das unidades", "/dashboard/operations", widgetIcons.operationsHub, "warn"),
    ],
    kpis: [
      { label: "Pendentes", value: String(pendingTaskCount), icon: widgetIcons.tasks, tone: "info" },
      { label: "Vencidas", value: String(overdueTasks.length), tone: overdueTasks.length > 0 ? "danger" : "muted", icon: widgetIcons.alerts },
      { label: "Aprovações", value: String(approvalTasks.length), tone: approvalTasks.length > 0 ? "warn" : "muted", icon: widgetIcons.processes },
    ] satisfies HubKpi[],
    attention: [
      ...(overdueTasks.length > 0 ? [{ title: "Tarefas vencidas", text: `${overdueTasks.length} com prazo anterior a hoje`, href: "/dashboard/tasks", tone: "danger", icon: widgetIcons.alerts } satisfies HubAttention] : []),
      ...(approvalTasks.length > 0 ? [{ title: "Aprovações pendentes", text: `${approvalTasks.length} aguardando você`, href: "/dashboard/tasks", tone: "warn", icon: widgetIcons.processes } satisfies HubAttention] : []),
    ],
    status: overdueTasks.length > 0 ? { tone: "danger" as const, label: `${overdueTasks.length} vencida(s)` } : pendingTaskCount > 0 ? { tone: "info" as const, label: `${pendingTaskCount} pendente(s)` } : null,
  }
  const aiHub = {
    links: [
      hubLink("Créditos GPT", "Saldo e consumo da OpenAI", "/dashboard/settings", widgetIcons.gpt, "accent"),
      hubLink("Google Cloud", "Custo e franquia", "/dashboard/settings", widgetIcons.cloud, "info"),
      hubLink("Alertas", "Limites e avisos de consumo", "/dashboard/settings", widgetIcons.alerts, "warn"),
    ],
  }

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
      <PageHero
        kicker="Gestão"
        title="Painel da gestão"
        subtitle={`Olá, ${user?.username}. Organize os indicadores e atalhos mais importantes para sua rotina.`}
        actions={<span className="hidden items-center gap-2 rounded-ds-btn border border-white/[.14] px-3 py-2 text-xs font-bold text-ds-on-dark-2 sm:inline-flex"><Calendar className="h-4 w-4" />{format(today, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>}
      />

      <ManagementDashboardBuilder firebaseUser={firebaseUser} userId={firebaseUser?.uid ?? user?.id ?? ""} userName={user?.username ?? "Usuário"} permissions={permissions}>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-6 xl:grid-cols-12">
        {canShowWidget("goals-revenue") && (
          <GoalsWidget
            revenue={currentRevenue}
            targetTotal={currentGoals.reduce((sum, goal) => sum + (goal.targetValue || 0), 0)}
            projected={projectedRevenue}
            rows={goalRows}
            goalCount={currentGoals.length}
            loading={goalsLoading}
            monthProgress={monthProgress}
            monthLabel={goalsMonthLabel}
            monthFilter={<MonthFilter label="Mês e ano das metas" value={goalsMonthValue} months={monthChoices} onChange={setGoalsMonth} />}
            formatMoney={formatCurrency}
            formatCompact={compactCurrency}
            onDetails={() => setGoalsModalOpen(true)}
          />
        )}

        {canShowWidget("pending-tasks") && <TasksWidget
          loading={tasksLoading}
          pendingCount={pendingTaskCount}
          overdueCount={overdueTasks.length}
          approvalCount={approvalTasks.length}
          dueTodayCount={dueTodayTasks.length}
          taskCount={taskNotifications.length}
          receiptCount={pendingReceipts.length}
          pending={taskItems.slice(0, 4)}
          approvals={approvalTaskItems.slice(0, 3)}
          overdue={overdueTaskItems.slice(0, 3)}
        />}

        {canShowWidget("critical-restock") && (
          <RestockWidget unitName={cdKiosk?.name ?? null} unavailableReason={restockUnavailable} items={restockItems} />
        )}

        {canShowWidget("best-sellers") && (
          <SalesWidget
            items={allBestSellers.slice(0, 8)}
            totalQuantity={salesTotalQuantity}
            periodLabel={formatSalesPeriod(visibleSalesReports)}
            onDetails={() => setSalesModalOpen(true)}
            unitFilter={
              <div className="flex gap-2 [&>*]:min-w-0 [&>*]:flex-1">
              <MonthFilter label="Mês e ano das vendas" value={salesMonthValue} months={monthChoices} onChange={setSalesMonth} />
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
              </div>
            }
          />
        )}

        {canShowWidget("weekly-schedule") && (
          <ScheduleWidget
            days={scheduleDays}
            emptyMessage={scheduleEmptyMessage}
            unitLabel={scheduleUnitLabel}
            onMonth={() => setScheduleModalOpen(true)}
            unitFilter={
              currentSchedules.length > 0 ? (
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
              ) : null
            }
          />
        )}

        {canShowWidget("vacation-calendar") && (
          <VacationsWidget loading={vacationsLoading} items={vacationItems} monthLabel={monthLabel} monthDays={daysInMonth} todayDay={today.getDate()} onDetails={() => setVacationsModalOpen(true)} />
        )}

        {canShowWidget("pending-payments") && (
          <PaymentsWidget
            loading={expensesLoading}
            overdueTotal={financialSummary.overdueTotal}
            upcomingTotal={financialSummary.upcomingTotal}
            overdueCount={financialSummary.overdue.length}
            upcomingCount={financialSummary.upcoming.length}
            rows={paymentRows}
            formatMoney={formatCurrency}
            onDetails={() => setPaymentsModalOpen(true)}
          />
        )}

        {canShowWidget("financial-shortcuts") && <HubWidget widgetId="financial-shortcuts" title="Central financeira" compactTitle="Financeiro" subtitle="Caixa, despesas e DRE" href="/dashboard/financial" icon={widgetIcons.financeHub} tone="ok" {...financeHub} />}
        {canShowWidget("stock-shortcuts") && <HubWidget widgetId="stock-shortcuts" title="Central de estoque" compactTitle="Estoque" subtitle="Controle, compras e análises" href="/dashboard/stock" icon={widgetIcons.stockHub} tone="warn" {...stockHub} />}
        {canShowWidget("people-shortcuts") && <HubWidget widgetId="people-shortcuts" title="Central de pessoas" compactTitle="Pessoas" subtitle="Equipe, escalas, férias e documentos" href="/dashboard/dp" icon={widgetIcons.peopleHub} tone="info" {...peopleHub} />}
        {canShowWidget("operations-shortcuts") && <HubWidget widgetId="operations-shortcuts" title="Central de operações" compactTitle="Operações" subtitle="Tarefas, formulários e rotinas" href="/dashboard/operations" icon={widgetIcons.operationsHub} tone="accent" {...operationsHub} />}
        {canShowWidget("ai-costs-shortcuts") && <HubWidget widgetId="ai-costs-shortcuts" title="IA e infraestrutura" compactTitle="IA e infra" subtitle="Custos, limites e alertas dos serviços" href="/dashboard/settings" icon={widgetIcons.aiHub} tone="neutral" {...aiHub} />}
      </div>
      </ManagementDashboardBuilder>

      <Dialog open={goalsModalOpen} onOpenChange={setGoalsModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-ds-modal border border-ds-border bg-ds-surface p-0 shadow-ds-modal sm:max-w-3xl">
          <DialogHeader>
            <div className="px-6 pt-6">
              <div className="mb-2 inline-flex rounded-full bg-ds-accent-soft px-3 py-1 text-xs font-black text-ds-accent-ink">Detalhe das metas</div>
              <DialogTitle className="text-2xl font-black text-ds-ink">Faturamento e metas</DialogTitle>
              <DialogDescription className="text-base font-semibold text-ds-ink-faint">Progresso atual por quiosque e consolidado geral.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="border-t border-ds-divider p-6">
            <div className="mb-6 grid gap-3 md:grid-cols-3">
              <Metric label="Faturamento" value={compactCurrency(currentRevenue)} detail={goalsMonthLabel} />
              <Metric label="Meta geral" value={compactCurrency(currentGoals.reduce((sum, goal) => sum + (goal.targetValue || 0), 0))} detail={`${currentGoals.length} meta(s) no mês`} />
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
