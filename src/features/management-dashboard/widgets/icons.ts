import {
  AlertTriangle, Banknote, BarChart3, Boxes, CalendarCheck2, CalendarDays, ClipboardCheck, ClipboardList, Clock3, Cpu,
  FileText, Gift, Inbox, LayoutGrid, ListChecks, MapPin, PackageCheck, PieChart, Receipt, Repeat2, ShoppingCart,
  Sparkles, Sun, Target, Timer, TrendingUp, Trophy, Truck, UserPlus, UsersRound, Wallet, Workflow, Cloud, Gauge, Bell, Landmark, CreditCard, FolderTree, ArrowLeftRight, Undo2, LogOut, Wrench, ShieldAlert, Droplets, IceCream2, Zap, Home, Wifi,
  type LucideIcon,
} from "lucide-react";

/**
 * Catálogo semântico dos ícones do painel. Cada função de negócio tem seu próprio ícone,
 * para o painel não repetir o mesmo desenho em lugares diferentes. Trocar a biblioteca
 * (Phosphor, Tabler) é mudar só este arquivo.
 */
export const widgetIcons = {
  goals: Target, sales: Trophy, restock: AlertTriangle, tasks: ClipboardCheck, schedule: UsersRound, absences: CalendarDays,
  payments: CreditCard, financeHub: Landmark, stockHub: Boxes, peopleHub: UsersRound, operationsHub: Workflow, aiHub: Cpu,
  expenses: Receipt, cash: Banknote, requests: Inbox, income: TrendingUp, reconciliation: ArrowLeftRight, statements: FileText, budgets: PieChart,
  accounts: FolderTree, inventory: Boxes, purchasing: ShoppingCart, counting: ClipboardList, movements: Truck, analysis: BarChart3, expiry: Timer,
  returns: Undo2, places: MapPin, collaborators: UsersRound, schedules: CalendarCheck2, vacation: Sun, documents: FileText, admissions: UserPlus,
  workday: Clock3, benefits: Gift, termination: LogOut, forms: ClipboardList, processes: Workflow, checklists: ListChecks, routines: Repeat2,
  incidents: ShieldAlert, templates: LayoutGrid, reports: BarChart3, gpt: Sparkles, cloud: Cloud, limits: Gauge, alerts: Bell, maintenance: Wrench,
  received: PackageCheck, dairy: Droplets, cone: IceCream2, energy: Zap, rent: Home, internet: Wifi, wallet: Wallet,
} satisfies Record<string, LucideIcon>;

export type WidgetIconName = keyof typeof widgetIcons;
