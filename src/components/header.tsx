"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { UserProfile } from "./user-profile";
import { type LegacyTask, NotificationCenter } from "./notification-center";
import { GlobalBarcodeScanner } from "./global-barcode-scanner";

interface HeaderProps {
  onMenuClick: () => void;
  tasks: LegacyTask[];
}

export function Header({ onMenuClick, tasks }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/80 backdrop-blur-sm px-4 lg:h-[60px] lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 flex-shrink-0"
        onClick={onMenuClick}
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <span className="font-semibold text-sm tracking-tight hidden sm:block text-foreground/80">
        {brand.shortName}
      </span>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <GlobalBarcodeScanner />
        <NotificationCenter tasks={tasks} />
        <UserProfile />
      </div>
    </header>
  );
}
