"use client"

import Link from "next/link"
import { Menu, Home, Boxes, ClipboardList, ClipboardCheck, Users } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { UserProfile } from "@/components/user-profile"
import { useAuth } from "@/hooks/use-auth"


export function Header() {
    const { permissions } = useAuth()
    const canManageUsers = permissions.users.add || permissions.users.edit || permissions.users.delete;
    
    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: Home },
        { href: '/dashboard/inventory', label: 'Conversão de Inventário', icon: Boxes },
        { href: '/dashboard/predefined', label: 'Conversão Predefinida', icon: ClipboardList },
        { href: '/dashboard/expiry', label: 'Controle de Validade', icon: ClipboardCheck },
        ...(canManageUsers ? [{ href: '/dashboard/users', label: 'Gerenciar Usuários', icon: Users }] : [])
    ]

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background px-4 lg:h-[60px] lg:px-6">
        <Sheet>
            <SheetTrigger asChild>
                <Button
                variant="outline"
                size="icon"
                className="shrink-0 md:hidden"
                >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col">
                <nav className="grid gap-2 text-lg font-medium">
                    <Link
                        href="/dashboard"
                        className="flex items-center gap-2 text-lg font-semibold mb-4 font-logo"
                    >
                        <div className="text-2xl text-primary">coala</div>
                        <div className="text-xl text-accent -mt-2">shakes</div>
                    </Link>
                    {navItems.map(item => (
                    <SheetTrigger asChild key={item.href}>
                        <Link
                            href={item.href}
                            className="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"
                        >
                            <item.icon className="h-5 w-5" />
                            {item.label}
                        </Link>
                    </SheetTrigger>
                    ))}
                </nav>
            </SheetContent>
        </Sheet>
        <div className="w-full flex-1">
            {/* Can add search or other header items here */}
        </div>
        <UserProfile />
    </header>
  )
}
