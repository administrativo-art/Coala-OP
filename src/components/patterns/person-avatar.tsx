"use client"

import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

/** Iniciais da primeira e da última palavra do nome ("Luis Abelardo" → "LA"). */
export function personInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const first = words[0][0] ?? ""
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : ""
  return `${first}${last}`.toUpperCase()
}

export interface PersonAvatarProps {
  name: string
  /** Foto do cadastro; sem foto (ou se falhar ao carregar) aparecem as iniciais. */
  avatarUrl?: string | null
  /** Cor que a escala deu à pessoa; sem cor, um cinza neutro. */
  color?: string | null
  size?: number
  className?: string
}

/**
 * Foto redonda da pessoa com iniciais de reserva. Decorativa: o nome sempre aparece ao lado,
 * por isso a imagem não repete o texto alternativo.
 */
export function PersonAvatar({ name, avatarUrl, color, size = 40, className }: PersonAvatarProps) {
  return (
    <Avatar className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      <AvatarImage src={avatarUrl || undefined} alt="" className="object-cover" />
      <AvatarFallback
        className="bg-ds-ink-muted font-extrabold tracking-[.02em] text-white"
        style={{ backgroundColor: color || undefined, fontSize: size < 40 ? 12 : 14 }}
      >
        {personInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
