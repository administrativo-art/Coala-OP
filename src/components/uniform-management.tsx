"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Loader2, Shirt, Users } from "lucide-react";

import { fetchUniformOverview, type UniformOverview } from "@/features/uniforms/client";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EMPTY_OVERVIEW: UniformOverview = { lots: [], assignments: [], events: [] };

function conditionLabel(value?: string) {
  return value === "novo" ? "Novo" : value === "usado" ? "Usado" : value || "-";
}

function eventLabel(value: string) {
  return value.replace("UNIFORME_", "").replaceAll("_", " ").toLowerCase();
}

function sizeLabel(value?: string | null) {
  const text = String(value ?? "").trim();
  return text || "Sem tamanho";
}

function uniformDetails(item: { apparelType?: string | null; apparelColor?: string | null }) {
  return [item.apparelType, item.apparelColor].filter(Boolean).join(" · ");
}

function ItemPhoto({ item }: { item: { imageUrl?: string | null; productName?: string | null } }) {
  if (item.imageUrl) {
    return (
      <img
        src={item.imageUrl}
        alt={item.productName ?? "Uniforme"}
        className="h-11 w-11 rounded-xl border bg-muted object-cover"
        loading="lazy"
      />
    );
  }

  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-muted text-muted-foreground">
      <Shirt className="h-5 w-5" />
    </div>
  );
}

function formatEventDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

export function UniformManagement() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [overview, setOverview] = useState<UniformOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setOverview(await fetchUniformOverview(firebaseUser));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Falha ao carregar uniformes",
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const available = overview.lots
      .filter((lot) => (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
    const newItems = overview.lots
      .filter((lot) => lot.condition === "novo" && (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
    const usedItems = overview.lots
      .filter((lot) => lot.condition === "usado" && (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
    const inPossession = overview.assignments.reduce(
      (sum, assignment) => sum + assignment.quantityInPossession,
      0,
    );
    return { available, newItems, usedItems, inPossession };
  }, [overview]);

  const sizeSummary = useMemo(() => {
    const rows = new Map<string, { size: string; available: number; inPossession: number }>();
    const ensure = (size?: string | null) => {
      const key = sizeLabel(size);
      const current = rows.get(key);
      if (current) return current;
      const row = { size: key, available: 0, inPossession: 0 };
      rows.set(key, row);
      return row;
    };

    overview.lots
      .filter((lot) => (lot.uniformStockStatus ?? "disponivel") === "disponivel")
      .forEach((lot) => {
        ensure(lot.apparelSize).available += Number(lot.quantity ?? 0);
      });
    overview.assignments
      .filter((assignment) => assignment.quantityInPossession > 0)
      .forEach((assignment) => {
        ensure(assignment.apparelSize).inPossession += Number(assignment.quantityInPossession ?? 0);
      });

    return Array.from(rows.values()).sort((left, right) => left.size.localeCompare(right.size, "pt-BR"));
  }, [overview]);

  if (!permissions.stock.uniforms?.view) {
    return <p className="text-sm text-muted-foreground">Sem permissão para visualizar o estoque de uniformes.</p>;
  }
  if (loading) {
    return <div className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Disponíveis", value: stats.available, icon: Boxes },
          { label: "Novos", value: stats.newItems, icon: Shirt },
          { label: "Usados", value: stats.usedItems, icon: Shirt },
          { label: "Em posse", value: stats.inPossession, icon: Users },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><p className="text-2xl font-bold">{value}</p></CardContent>
          </Card>
        ))}
      </div>

      {sizeSummary.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Resumo por tamanho</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {sizeSummary.map((row) => (
                <div key={row.size} className="rounded-xl border bg-muted/20 p-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Tamanho</p>
                  <p className="text-lg font-bold">{row.size}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.available} disponível(is) · {row.inPossession} em posse
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Estoque</TabsTrigger>
          <TabsTrigger value="possession">Em posse</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>
        <TabsContent value="stock">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Peça</TableHead><TableHead>Tamanho</TableHead><TableHead>Condição</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Quantidade</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {overview.lots.map((lot) => (
                    <TableRow key={lot.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ItemPhoto item={lot} />
                          <div>
                            <p className="font-medium">{lot.productName}</p>
                            {uniformDetails(lot) ? <p className="text-xs text-muted-foreground">{uniformDetails(lot)}</p> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{sizeLabel(lot.apparelSize)}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{conditionLabel(lot.condition)}</Badge></TableCell>
                      <TableCell>{lot.uniformStockStatus === "disponivel" || !lot.uniformStockStatus ? "Disponível" : "Indisponível"}</TableCell>
                      <TableCell className="text-right font-bold">{lot.quantity}</TableCell>
                    </TableRow>
                  ))}
                  {overview.lots.length === 0 ? <TableRow><TableCell colSpan={5} className="h-24 text-center">Nenhuma peça no estoque de uniformes.</TableCell></TableRow> : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="possession">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Colaborador</TableHead><TableHead>Peça</TableHead><TableHead>Tamanho</TableHead><TableHead>Condição entregue</TableHead><TableHead className="text-right">Em posse</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {overview.assignments.filter((item) => item.quantityInPossession > 0).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.collaboratorName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ItemPhoto item={item} />
                          <div>
                            <p>{item.productName}</p>
                            {uniformDetails(item) ? <p className="text-xs text-muted-foreground">{uniformDetails(item)}</p> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{sizeLabel(item.apparelSize)}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{conditionLabel(item.issuedCondition)}</Badge></TableCell>
                      <TableCell className="text-right font-bold">{item.quantityInPossession}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="history">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Data</TableHead><TableHead>Colaborador</TableHead><TableHead>Peça</TableHead><TableHead>Tamanho</TableHead><TableHead>Movimento</TableHead><TableHead className="text-right">Quantidade</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {overview.events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{formatEventDate(event.occurredAt)}</TableCell>
                      <TableCell>{event.collaboratorName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ItemPhoto item={event} />
                          <div>
                            <p>{event.productName}</p>
                            {uniformDetails(event) ? <p className="text-xs text-muted-foreground">{uniformDetails(event)}</p> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{sizeLabel(event.apparelSize)}</Badge></TableCell>
                      <TableCell className="capitalize">{eventLabel(event.eventType)}</TableCell>
                      <TableCell className="text-right font-bold">{event.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
