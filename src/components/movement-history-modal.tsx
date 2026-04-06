

"use client"

import { useMemo, useState, useEffect } from 'react';
import { DateRange } from 'react-day-picker';
import { format, parseISO, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History, ArrowRight, ArrowDownUp, Download, ChevronsUpDown, CalendarIcon, Search } from 'lucide-react';
import { useMovementHistory } from '@/hooks/use-movement-history';
import { Skeleton } from './ui/skeleton';
import { useProducts } from '@/hooks/use-products';
import { useKiosks } from '@/hooks/use-kiosks';
import { useAuth } from '@/hooks/use-auth';
import { type MovementRecord, type MovementType } from '@/types';
import { Badge } from './ui/badge';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';

const MOVEMENT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
    'ENTRADA': { label: 'Entrada', color: 'bg-green-100 text-green-800' },
    'SAIDA_CONSUMO': { label: 'Venda/Consumo', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_VENCIMENTO': { label: 'Descarte por Vencimento', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_AVARIA': { label: 'Descarte por Avaria', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_PERDA': { label: 'Extravio de Mercadoria', color: 'bg-red-100 text-red-800' },
    'SAIDA_DESCARTE_OUTROS': { label: 'Descarte Outros', color: 'bg-red-100 text-red-800' },
    'SAIDA_CORRECAO': { label: 'Divergência (decréscimo)', color: 'bg-red-100 text-red-800' },
    'ENTRADA_CORRECAO': { label: 'Divergência (acréscimo)', color: 'bg-green-100 text-green-800' },
    'TRANSFERENCIA_SAIDA': { label: 'Transferência (Saída)', color: 'bg-blue-100 text-blue-800' },
    'TRANSFERENCIA_ENTRADA': { label: 'Transferência (Entrada)', color: 'bg-blue-100 text-blue-800' },
    'ENTRADA_ESTORNO': { label: 'Estorno (Entrada)', color: 'bg-red-100 text-red-800' },
    'SAIDA_ESTORNO': { label: 'Estorno (Saída)', color: 'bg-green-100 text-green-800' },
};

const ITEMS_PER_PAGE = 50;

type SortKey = keyof MovementRecord | 'productName' | 'kioskName';
type SortDirection = 'asc' | 'desc';

interface MovementHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBaseProductId?: string;
  initialType?: string;
  initialKioskId?: string;
  initialDateRange?: { from: Date; to: Date };
}

export function MovementHistoryModal({ 
  open, 
  onOpenChange, 
  initialBaseProductId, 
  initialType, 
  initialKioskId, 
  initialDateRange 
}: MovementHistoryModalProps) {
  const { history, loading: loadingHistory } = useMovementHistory();
  const { products, getProductFullName, loading: loadingProducts } = useProducts();
  const { kiosks, loading: loadingKiosks } = useKiosks();
  const { users } = useAuth();
  
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialDateRange);
  const [typeFilter, setTypeFilter] = useState(initialType || 'all');
  const [kioskFilter, setKioskFilter] = useState(initialKioskId || 'all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  // Sync state when props change (specifically when opening from dashboard)
  useEffect(() => {
    if (open) {
      if (initialDateRange) setDateRange(initialDateRange);
      if (initialType) setTypeFilter(initialType);
      if (initialKioskId) setKioskFilter(initialKioskId);
      if (initialBaseProductId) {
          // If we have a base product ID, we search for products that belong to it
          const bpProducts = products.filter(p => p.baseProductId === initialBaseProductId);
          if (bpProducts.length > 0) {
              setSearchTerm(bpProducts[0].baseName || '');
          }
      } else {
          setSearchTerm('');
      }
      setCurrentPage(1);
    }
  }, [open, initialDateRange, initialType, initialKioskId, initialBaseProductId, products]);
  
  const loading = loadingHistory || loadingProducts || loadingKiosks;

  const enrichedHistory = useMemo(() => {
    if (loading) return [];
    const kioskMap = new Map(kiosks.map(k => [k.id, k.name]));
    return history.map(record => {
      let mainKioskName = 'N/A';
      if(record.type?.startsWith('TRANSFERENCIA')) {
        mainKioskName = kioskMap.get(record.fromKioskId!) || 'N/A';
      } else {
        mainKioskName = kioskMap.get(record.fromKioskId! || record.toKioskId!) || 'N/A';
      }

      return {
        ...record,
        productName: products.find(p => p.id === record.productId)?.baseName || record.productName,
        kioskName: mainKioskName
      };
    });
  }, [history, products, kiosks, loading]);

  const filteredAndSortedHistory = useMemo(() => {
    let filtered = enrichedHistory;

    // Direct Base Product Filter (from drill-down)
    if (initialBaseProductId) {
        filtered = filtered.filter(item => {
            const product = products.find(p => p.id === item.productId);
            return product?.baseProductId === initialBaseProductId;
        });
    }

    if (dateRange?.from) {
      filtered = filtered.filter(item => {
        if (!item.timestamp) return false;
        const itemDate = parseISO(item.timestamp);
        return isValid(itemDate) && itemDate >= dateRange.from!;
      });
    }
    if (dateRange?.to) {
      filtered = filtered.filter(item => {
        if (!item.timestamp) return false;
        const itemDate = parseISO(item.timestamp);
        const toDate = new Date(dateRange.to!);
        toDate.setHours(23, 59, 59, 999);
        return isValid(itemDate) && itemDate <= toDate;
      });
    }
    if (typeFilter !== 'all') {
      filtered = filtered.filter(item => {
        const isTransfer = item.type?.includes('TRANSFERENCIA');
        
        if (typeFilter === 'ENTRADA') {
            if (item.type === 'ENTRADA') return true;
            if (isTransfer) {
                return kioskFilter !== 'all' ? item.toKioskId === kioskFilter : item.type === 'TRANSFERENCIA_ENTRADA';
            }
            return false;
        } else if (typeFilter === 'SAIDA') {
            const isExit = item.type?.startsWith('SAIDA_') || item.type === 'ENTRADA_ESTORNO';
            if (isExit) return true;
            if (isTransfer) {
                return kioskFilter !== 'all' ? item.fromKioskId === kioskFilter : item.type === 'TRANSFERENCIA_SAIDA';
            }
            return false;
        } else if (typeFilter === 'AJUSTE') {
            return (item.type?.includes('CORRECAO') || item.type?.includes('Divergência'));
        }
        return item.type === typeFilter;
      });
    }
    if (kioskFilter !== 'all') {
        filtered = filtered.filter(item => item.fromKioskId === kioskFilter || item.toKioskId === kioskFilter);
    }
    if (searchTerm && !initialBaseProductId) {
        const lowerCaseSearch = searchTerm.toLowerCase();
        filtered = filtered.filter(item => 
            (item.productName || '').toLowerCase().includes(lowerCaseSearch) ||
            (item.lotNumber || '').toLowerCase().includes(lowerCaseSearch) ||
            (item.username || '').toLowerCase().includes(lowerCaseSearch) ||
            (item.notes || '').toLowerCase().includes(lowerCaseSearch)
        );
    }

    return filtered.sort((a, b) => {
      const aVal = a[sortKey as keyof MovementRecord];
      const bVal = b[sortKey as keyof MovementRecord];
      
      let compareResult = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        compareResult = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        compareResult = aVal - bVal;
      }

      return sortDirection === 'asc' ? compareResult : -compareResult;
    });
  }, [enrichedHistory, dateRange, typeFilter, kioskFilter, searchTerm, sortKey, sortDirection, initialBaseProductId, products]);

  const paginatedHistory = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedHistory.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredAndSortedHistory, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedHistory.length / ITEMS_PER_PAGE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const { totalEntradas, totalSaidas, totalAjustes, totalTransferencias } = useMemo(() => {
    return filteredAndSortedHistory.reduce((acc, item) => {
        const qty = typeof item.quantityChange === 'number' && !isNaN(item.quantityChange) ? Math.abs(item.quantityChange) : 0;
        const isTransfer = item.type?.includes('TRANSFERENCIA');
        const isAdjustment = item.type?.includes('CORRECAO') || item.type?.includes('Divergência');

        if (kioskFilter !== 'all') {
            const isToThisKiosk = item.toKioskId === kioskFilter;
            const isFromThisKiosk = item.fromKioskId === kioskFilter;

            if (isAdjustment && (isToThisKiosk || isFromThisKiosk)) {
                acc.totalAjustes += (item.quantityChange || 0);
            } else if (isTransfer) {
                if (isToThisKiosk) acc.totalEntradas += qty;
                else if (isFromThisKiosk) acc.totalSaidas += qty;
                if (isToThisKiosk || isFromThisKiosk) acc.totalTransferencias += qty;
            } else if (item.type === 'ENTRADA') {
                if (isToThisKiosk) acc.totalEntradas += qty;
            } else if (item.type?.startsWith('SAIDA_') || item.type === 'ENTRADA_ESTORNO') {
                if (isFromThisKiosk) acc.totalSaidas += qty;
            }
        } else {
            // Global view logic
            if (isAdjustment) {
                acc.totalAjustes += (item.quantityChange || 0);
            } else if (isTransfer) {
                acc.totalTransferencias += qty;
                // We don't add transfers to global entry/exit totals to avoid duplication
            } else if (item.type === 'ENTRADA' || item.type === 'SAIDA_ESTORNO') {
                acc.totalEntradas += qty;
            } else if (item.type?.startsWith('SAIDA_') || item.type === 'ENTRADA_ESTORNO') {
                acc.totalSaidas += qty;
            }
        }
        return acc;
    }, { totalEntradas: 0, totalSaidas: 0, totalTransferencias: 0, totalAjustes: 0 });
  }, [filteredAndSortedHistory, kioskFilter]);


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Auditoria de movimentações</DialogTitle>
          <DialogDescription>
            Consulte o histórico completo de todas as entradas, saídas, ajustes e transferências de estoque.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-grow">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar produto, lote, usuário, observação..." className="pl-10" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
            <Popover>
                <PopoverTrigger asChild>
                    <Button id="date" variant="outline" className={cn("w-full sm:w-[300px] justify-start text-left font-normal", !dateRange && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRange?.from ? (dateRange.to ? <>{format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}</> : format(dateRange.from, "LLL dd, y")) : <span>Selecione uma data</span>}
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar initialFocus mode="range" defaultMonth={dateRange?.from} selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                </PopoverContent>
            </Popover>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Todos os Tipos</SelectItem>
                    {Object.entries(MOVEMENT_TYPE_CONFIG).map(([key, {label}]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
                </SelectContent>
            </Select>
            <Select value={kioskFilter} onValueChange={setKioskFilter}>
                <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Todos os quiosques" /></SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Todos os Quiosques</SelectItem>
                    {kiosks.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                </SelectContent>
            </Select>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total de Entradas</p><p className="text-2xl font-bold">{totalEntradas.toLocaleString()}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total de Saídas</p><p className="text-2xl font-bold">{totalSaidas.toLocaleString()}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total em Transferências</p><p className="text-2xl font-bold">{totalTransferencias.toLocaleString()}</p></CardContent></Card>
        </div>
        
        <div className="flex-grow overflow-hidden border rounded-lg flex flex-col">
          <ScrollArea className="flex-1">
              {loading ? (
                  <div className="p-4"><Skeleton className="h-64 w-full" /></div>
              ) : (
                  <Table>
                      <TableHeader className="sticky top-0 bg-muted z-10">
                      <TableRow>
                          {['timestamp', 'productName', 'lotNumber', 'type', 'fromKioskId', 'quantityChange', 'username', 'notes'].map(key => {
                              const labels: Record<string, string> = { timestamp: 'Data', productName: 'Produto', lotNumber: 'Lote', type: 'Tipo', fromKioskId: 'Quiosque', quantityChange: 'Qtd.', username: 'Usuário', notes: 'Observação' };
                              return (
                                  <TableHead key={key} className="cursor-pointer hover:bg-muted-foreground/10" onClick={() => handleSort(key as SortKey)}>
                                      <div className="flex items-center gap-2">
                                          {labels[key]}
                                          {sortKey === key && <ArrowDownUp className="h-3 w-3" />}
                                      </div>
                                  </TableHead>
                              )
                          })}
                      </TableRow>
                      </TableHeader>
                      <TableBody>
                      {paginatedHistory.length > 0 ? paginatedHistory.map((item) => {
                          let kioskDisplay = '';
                          const timestampDate = item.timestamp ? parseISO(item.timestamp) : null;

                           if (item.type?.includes('TRANSFERENCIA')) {
                                kioskDisplay = `${item.fromKioskName || ''} → ${item.toKioskName || ''}`;
                            } else {
                                kioskDisplay = item.kioskName || 'N/A';
                            }
                          
                          return (
                              <TableRow key={item.id}>
                                  <TableCell className="text-xs font-semibold">{timestampDate && isValid(timestampDate) ? format(timestampDate, "dd/MM/yy HH:mm", { locale: ptBR }) : 'N/A'}</TableCell>
                                  <TableCell>
                                      <TooltipProvider><Tooltip><TooltipTrigger>
                                          <p className="font-medium truncate max-w-xs">{item.productName}</p>
                                      </TooltipTrigger><TooltipContent><p>{item.productName}</p></TooltipContent></Tooltip></TooltipProvider>
                                  </TableCell>
                                  <TableCell>{item.lotNumber}</TableCell>
                                  <TableCell>
                                      {item.type && MOVEMENT_TYPE_CONFIG[item.type] ? (() => {
                                          let label = MOVEMENT_TYPE_CONFIG[item.type].label;
                                          let color = MOVEMENT_TYPE_CONFIG[item.type].color;

                                          if (item.type.includes('TRANSFERENCIA') && kioskFilter !== 'all') {
                                              if (item.toKioskId === kioskFilter) {
                                                  label = 'Transferência (Entrada)';
                                                  color = 'bg-blue-100 text-blue-800';
                                              } else if (item.fromKioskId === kioskFilter) {
                                                  label = 'Transferência (Saída)';
                                                  color = 'bg-blue-100 text-blue-800';
                                              }
                                          }

                                          return (
                                              <Badge className={cn("text-xs", color)}>
                                                  {label}
                                              </Badge>
                                          );
                                      })() : (
                                          <Badge variant="secondary">{item.type || 'N/A'}</Badge>
                                      )}
                                  </TableCell>
                                  <TableCell className="text-xs">{kioskDisplay}</TableCell>
                                  <TableCell className="text-right font-bold">{(item.quantityChange ?? 0).toLocaleString('pt-BR')}</TableCell>
                                  <TableCell>{item.username}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground italic">{item.notes}</TableCell>
                              </TableRow>
                          )
                      }) : (
                          <TableRow><TableCell colSpan={8} className="h-24 text-center">Nenhum registro encontrado com os filtros atuais.</TableCell></TableRow>
                      )}
                      </TableBody>
                  </Table>
              )}
          </ScrollArea>
        </div>
        <DialogFooter className="pt-4 border-t shrink-0 flex-row justify-between w-full">
            <p className="text-sm text-muted-foreground">Página {currentPage} de {totalPages}</p>
            <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCurrentPage(p => p - 1)} disabled={currentPage === 1}>Anterior</Button>
                <Button variant="outline" onClick={() => setCurrentPage(p => p + 1)} disabled={currentPage >= totalPages}>Próxima</Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
