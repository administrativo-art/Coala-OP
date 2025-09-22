
"use client"

import Link from "next/link"
import { Menu, LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, ClipboardCheck, Users, ListPlus, Settings, ShoppingCart, LifeBuoy, DollarSign, ListTodo, AreaChart, Camera } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { UserProfile } from "./user-profile"
import { ThemeToggle } from "./theme-toggle"
import { type LegacyTask, NotificationCenter } from "./notification-center"
import { GlobalBarcodeScanner } from "./global-barcode-scanner"
import { Sidebar } from "./sidebar"


export function Header({ tasks }: { tasks: LegacyTask[] }) {
  const { permissions, loading, user } = useAuth()

  const canManageUsers = !loading && permissions.settings.view;
  const canManageStock = !loading && permissions.stock.view;
  const canManageTeam = !loading && permissions.team.view;
  const canUseHelp = !loading && permissions.help.view;
  const isMasterUser = user?.username === 'Tiago Brasil';
  const canRegister = !loading && permissions.registration.view;
  const canSimulatePricing = !loading && permissions.pricing.view;
  const canViewTasks = !loading && permissions.tasks.view;

  return (
    <header className="sticky top-0 flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6 z-30">
        <Sheet>
            <SheetTrigger asChild>
                <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Menu de navegação</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Menu Principal</SheetTitle>
                </SheetHeader>
                <Sidebar />
            </SheetContent>
        </Sheet>
        <div className="w-full flex-1">
        </div>
        <div className="flex items-center gap-2">
          <GlobalBarcodeScanner />
          <NotificationCenter tasks={tasks} />
          <ThemeToggle />
          <UserProfile />
        </div>
    </header>
  )
}
