"use client";

import { useState } from 'react';
import { pdf, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { FileDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtK(v: number) {
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return v > 0 ? v.toFixed(0) : '—';
}

const S = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#222' },
  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: '#e2e8f0' },
  title: { fontSize: 16, fontWeight: 'bold' },
  subtitle: { fontSize: 9, color: '#64748b', marginTop: 2 },
  // Section
  sectionTitle: { fontSize: 10, fontWeight: 'bold', color: '#2563eb', marginBottom: 8, marginTop: 14, paddingLeft: 6, borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: '#2563eb' },
  // KPI grid
  kpiGrid: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  kpiCard: { flex: 1, padding: 8, backgroundColor: '#f8fafc', borderRadius: 4, borderWidth: 1, borderStyle: 'solid', borderColor: '#e2e8f0' },
  kpiLabel: { fontSize: 7, color: '#64748b', textTransform: 'uppercase', marginBottom: 3 },
  kpiValue: { fontSize: 13, fontWeight: 'bold' },
  kpiSub: { fontSize: 7, color: '#94a3b8', marginTop: 2 },
  // Progress bar
  progressWrap: { marginBottom: 4 },
  progressLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  progressTrack: { height: 6, backgroundColor: '#e2e8f0', borderRadius: 3 },
  progressFill: { height: 6, borderRadius: 3 },
  // Alerts
  alertsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, marginBottom: 2 },
  alertBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: '#f1f5f9', fontSize: 7, fontWeight: 'bold', color: '#475569' },
  // Table
  table: { borderWidth: 1, borderStyle: 'solid', borderColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: '#e2e8f0' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: '#f1f5f9' },
  tableRowLast: { flexDirection: 'row' },
  cell: { padding: 5, fontSize: 8 },
  cellBold: { padding: 5, fontSize: 8, fontWeight: 'bold' },
  // Daily table
  dayHeader: { width: 16, padding: 2, fontSize: 6, textAlign: 'center', fontWeight: 'bold', color: '#94a3b8' },
  dayCell: { width: 16, padding: 2, fontSize: 6, textAlign: 'center' },
  // Footer
  footer: { marginTop: 'auto', paddingTop: 8, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: '#e2e8f0' },
});

function GoalReportPdf({ data }: { data: any }) {
  const green = '#16a34a';
  const red = '#dc2626';
  const amber = '#d97706';
  const blue = '#2563eb';

  return (
    <Document>
      <Page size="A4" style={S.page} orientation={data.monthDays.length > 20 ? 'landscape' : 'portrait'}>

        {/* ── HEADER ── */}
        <View style={S.header}>
          <View>
            <Text style={S.title}>Relatório de Desempenho de Metas</Text>
            <Text style={S.subtitle}>{data.kioskName} — {data.monthLabel}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#1e40af' }}>Coala ERP</Text>
            <Text style={{ fontSize: 7, color: '#94a3b8', marginTop: 2 }}>{format(new Date(), 'dd/MM/yyyy HH:mm')}</Text>
          </View>
        </View>

        {/* ── KPIs ── */}
        <Text style={S.sectionTitle}>Indicadores-Chave</Text>
        <View style={S.kpiGrid}>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Acumulado</Text>
            <Text style={[S.kpiValue, { color: data.totalPct >= 100 ? green : amber }]}>R$ {fmt(data.totalValue)}</Text>
            <Text style={S.kpiSub}>de R$ {fmt(data.target)}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>% da Meta</Text>
            <Text style={[S.kpiValue, { color: data.totalPct >= 100 ? green : amber }]}>{data.totalPct.toFixed(1)}%</Text>
            <Text style={S.kpiSub}>Esperado: {data.expectedPct.toFixed(1)}% | {data.diff >= 0 ? '▲' : '▼'} {Math.abs(data.diff).toFixed(1)} pp</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Projeção Final</Text>
            <Text style={[S.kpiValue, { color: data.projection >= data.target ? green : red }]}>R$ {fmt(data.projection)}</Text>
            <Text style={S.kpiSub}>
              {data.projection >= data.target ? `Excede R$ ${fmt(data.projection - data.target)}` : `Falta R$ ${fmt(data.target - data.projection)}`}
            </Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Pace Necessário</Text>
            <Text style={[S.kpiValue, { color: data.paceActual >= data.paceNeeded ? green : red }]}>R$ {fmt(data.paceNeeded)}/dia</Text>
            <Text style={S.kpiSub}>Atual: R$ {fmt(data.paceActual)}/dia</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiLabel}>Consistência</Text>
            <Text style={[S.kpiValue, { color: blue }]}>{data.kioskDaysWithSale}/{data.totalMonthDays} dias</Text>
            <Text style={S.kpiSub}>{data.remainingDays} dias restantes</Text>
          </View>
        </View>

        {/* ── PROGRESS BARS ── */}
        <Text style={S.sectionTitle}>Progresso das Metas</Text>
        <View style={[S.progressWrap, { marginBottom: 8 }]}>
          <View style={S.progressLabel}>
            <Text style={{ fontSize: 8, color: '#64748b', fontWeight: 'bold' }}>Meta Base — R$ {fmt(data.target)}</Text>
            <Text style={{ fontSize: 8, fontWeight: 'bold', color: data.totalPct >= 100 ? green : amber }}>{data.totalPct.toFixed(1)}%</Text>
          </View>
          <View style={S.progressTrack}>
            <View style={[S.progressFill, { width: `${Math.min(data.totalPct, 100)}%`, backgroundColor: data.totalPct >= 100 ? green : '#3b82f6' }]} />
          </View>
        </View>
        {data.upTarget > data.target && (
          <View style={S.progressWrap}>
            <View style={S.progressLabel}>
              <Text style={{ fontSize: 8, color: '#64748b', fontWeight: 'bold' }}>Super Meta (UP) — R$ {fmt(data.upTarget)}</Text>
              <Text style={{ fontSize: 8, fontWeight: 'bold', color: blue }}>{data.upPct.toFixed(1)}%</Text>
            </View>
            <View style={S.progressTrack}>
              <View style={[S.progressFill, { width: `${Math.min(data.upPct, 100)}%`, backgroundColor: '#6366f1' }]} />
            </View>
          </View>
        )}

        {/* ── ALERTAS ── */}
        {data.alerts.length > 0 && (
          <View style={S.alertsRow}>
            {data.alerts.map((a: string, i: number) => (
              <Text key={i} style={S.alertBadge}>{a}</Text>
            ))}
          </View>
        )}

        {/* ── COLABORADORES ── */}
        <Text style={S.sectionTitle}>Performance por Colaborador</Text>
        <View style={S.table}>
          <View style={S.tableHeader}>
            <Text style={[S.cellBold, { width: '22%' }]}>Colaborador</Text>
            <Text style={[S.cellBold, { width: '14%' }]}>Realizado</Text>
            <Text style={[S.cellBold, { width: '14%' }]}>Meta</Text>
            <Text style={[S.cellBold, { width: '8%' }]}>%</Text>
            <Text style={[S.cellBold, { width: '14%' }]}>Pace Atual</Text>
            <Text style={[S.cellBold, { width: '14%' }]}>Pace Nec.</Text>
            <Text style={[S.cellBold, { width: '14%' }]}>Consistência</Text>
          </View>
          {data.employees.map((emp: any, i: number) => {
            const isLast = i === data.employees.length - 1;
            return (
              <View key={i} style={isLast ? S.tableRowLast : S.tableRow}>
                <Text style={[S.cellBold, { width: '22%' }]}>{emp.name}</Text>
                <Text style={[S.cell, { width: '14%' }]}>R$ {fmt(emp.value)}</Text>
                <Text style={[S.cell, { width: '14%' }]}>R$ {fmt(emp.target)}</Text>
                <Text style={[S.cell, { width: '8%', color: emp.pct >= 100 ? green : amber, fontWeight: 'bold' }]}>{emp.pct.toFixed(1)}%</Text>
                <Text style={[S.cell, { width: '14%', color: emp.pace >= emp.paceNeeded ? green : red }]}>R$ {fmt(emp.pace)}</Text>
                <Text style={[S.cell, { width: '14%' }]}>R$ {fmt(emp.paceNeeded)}</Text>
                <Text style={[S.cell, { width: '14%' }]}>{emp.daysHit}/{emp.totalDays} dias</Text>
              </View>
            );
          })}
        </View>

        {/* ── PROGRESSO DIÁRIO ── */}
        <Text style={S.sectionTitle}>Progresso Diário</Text>
        <View style={S.table}>
          {/* Cabeçalho dos dias */}
          <View style={[S.tableHeader, { flexWrap: 'nowrap' }]}>
            <Text style={[S.cellBold, { width: 70 }]}>Colaborador</Text>
            {data.monthDays.map((d: any) => (
              <Text key={d.dateKey} style={S.dayHeader}>{d.label}</Text>
            ))}
          </View>
          {/* Linha Total Quiosque */}
          <View style={[S.tableRow, { backgroundColor: '#eff6ff' }]}>
            <Text style={[S.cellBold, { width: 70, fontSize: 7 }]}>Total Quiosque</Text>
            {data.monthDays.map((d: any) => {
              const val = d.kioskValue;
              const hit = val >= data.dailyAlvo;
              return (
                <Text key={d.dateKey} style={[S.dayCell, { color: val > 0 ? (hit ? green : amber) : '#cbd5e1' }]}>
                  {fmtK(val)}
                </Text>
              );
            })}
          </View>
          {/* Linhas dos colaboradores */}
          {data.employees.map((emp: any, ei: number) => {
            const isLast = ei === data.employees.length - 1;
            return (
              <View key={ei} style={isLast ? S.tableRowLast : S.tableRow}>
                <Text style={[S.cell, { width: 70, fontSize: 7 }]}>{emp.name.split(' ')[0]}</Text>
                {emp.dailyProgress.map((val: number, di: number) => {
                  const empDailyAlvo = emp.target / emp.totalDays;
                  const hit = val >= empDailyAlvo;
                  return (
                    <Text key={di} style={[S.dayCell, { color: val > 0 ? (hit ? green : amber) : '#cbd5e1' }]}>
                      {fmtK(val)}
                    </Text>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* ── FOOTER ── */}
        <View style={S.footer}>
          <Text style={{ fontSize: 7, color: '#94a3b8', textAlign: 'center' }}>
            Relatório gerado automaticamente pelo Coala Operation Control — {format(new Date(), 'dd/MM/yyyy HH:mm')}
          </Text>
        </View>

      </Page>
    </Document>
  );
}

export default function PdfDownloadButton({ data, fileName }: { data: any; fileName: string }) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const blob = await pdf(<GoalReportPdf data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" onClick={handleDownload} disabled={loading} className="bg-blue-600 hover:bg-blue-700">
      {loading ? (
        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando...</>
      ) : (
        <><FileDown className="mr-2 h-4 w-4" /> Exportar PDF</>
      )}
    </Button>
  );
}
