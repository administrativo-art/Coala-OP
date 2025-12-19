
"use client"

import Link from "next/link"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { UserProfile } from "./user-profile"
import { ThemeToggle } from "./theme-toggle"
import { type LegacyTask, NotificationCenter } from "./notification-center"
import { GlobalBarcodeScanner } from "./global-barcode-scanner"

interface HeaderProps {
  tasks: LegacyTask[];
  onMenuClick: () => void;
}

export function Header({ tasks, onMenuClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/60 backdrop-blur-lg px-4 lg:h-[60px] lg:px-6">
        <Button
          id="sidebar-trigger"
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Abrir/fechar menu</span>
        </Button>
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
