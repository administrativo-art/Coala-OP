"use client"

import { useAuth } from "@/hooks/use-auth"
import { useExpiryProducts } from "@/hooks/use-expiry-products"
import { useProducts } from "@/hooks/use-products"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Box, Package, AlertTriangle } from 'lucide-react'
import { differenceInDays, parseISO } from 'date-fns'

export default function DashboardPage() {
  const { user, users } = useAuth()
  const { lots } = useExpiryProducts()
  const { products } = useProducts()

  const lotsInKiosk = user?.role === 'admin' ? lots : lots.filter(lot => lot.kioskId === user?.kioskId);
  const expiringSoonCount = lotsInKiosk.filter(lot => {
      const days = differenceInDays(parseISO(lot.expiryDate), new Date());
      return days >= 0 && days <= 7;
  }).length;
  const expiredCount = lotsInKiosk.filter(lot => differenceInDays(parseISO(lot.expiryDate), new Date()) < 0).length;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Bem-vindo, {user?.username}!</h1>
      <p className="text-muted-foreground mb-6">Aqui está um resumo da sua operação.</p>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos Cadastrados</CardTitle>
            <Package className="h-6 w-6 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{products.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Lotes no seu Quiosque</CardTitle>
            <Box className="h-6 w-6 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{lotsInKiosk.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Vencendo em 7 dias</CardTitle>
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-yellow-500">{expiringSoonCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Produtos Vencidos</CardTitle>
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-destructive">{expiredCount}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
