
"use client"

import Link from "next/link"
import { Menu, LayoutDashboard, Repeat, CheckSquare, UserCog, ClipboardList, ClipboardCheck, Users, ListPlus, Settings, ShoppingCart, LifeBuoy, DollarSign, ListTodo, AreaChart, Camera } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { UserProfile } from "./user-profile"
import { ThemeToggle } from "./theme-toggle"
import { type LegacyTask, NotificationCenter } from "./notification-center"
import { GlobalBarcodeScanner } from "./global-barcode-scanner"

export function Header({ tasks }: { tasks: LegacyTask[] }) {
  const { permissions, loading, user } = useAuth()

  return (
    <header className="sticky top-0 z-30 w-full border-b border-transparent bg-transparent backdrop-blur-lg flex h-14 items-center gap-4 px-4 lg:h-[60px] lg:px-6">
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
