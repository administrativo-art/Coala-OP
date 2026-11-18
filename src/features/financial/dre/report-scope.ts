import { AppError } from "@/lib/observability/app-error";
import type { DreMetrics } from "./report";
export type ReportKiosk = { id: string; name: string; pdvFilialId?: string };
export type ReportCenter = { id: string; name: string; unitIds: string[] };
const denied = () => { throw new AppError({ code: "DRE_REPORT_CENTER_SCOPE", kind: "AUTHORIZATION", safeMessage: "O centro de resultado abrange unidades fora da seleção ou tem vínculo ambíguo. Selecione o conjunto integral autorizado; despesas individuais exigem atribuição aprovada." }); };
export function resolveDreReportScope(allKiosks: ReportKiosk[], centers: ReportCenter[], selectedIds: string[], canAccess: (id: string) => boolean) {
  const selected = new Set(selectedIds), names: Record<string, string> = {}, unitCenters: Record<string, string> = {};
  const sharedUnits = new Set<string>();
  const owners = new Map<string, Set<string>>();
  for (const c of centers) for (const ref of [c.id, c.name, ...c.unitIds]) { if (!owners.has(ref)) owners.set(ref, new Set()); owners.get(ref)!.add(c.id); }
  for (const kioskId of selected) {
    const kiosk = allKiosks.find(k => k.id === kioskId); if (!kiosk) denied();
    const links = centers.filter(c => c.unitIds.includes(kioskId));
    if (links.length > 1) denied();
    const center = links[0];
    if (!center) { if (centers.some(c => c.id === kiosk!.name || c.name === kiosk!.name)) denied(); continue; }
    if ([center.id, center.name, ...center.unitIds].some(ref => owners.get(ref)!.size !== 1)) denied();
    if (center.unitIds.some(id => !selected.has(id) || !canAccess(id))) denied();
    unitCenters[kioskId] = center.name;
    if (center.unitIds.length > 1) sharedUnits.add(kioskId);
  }
  for (const c of centers) { names[c.id] = c.name; names[c.name] = c.name; for (const id of c.unitIds) names[id] = c.name; }
  return { names, unitCenters, sharedUnits };
}
/** No approved attribution exists between the units of a shared center. Never duplicate its expenses. */
export function withoutSharedCenterUnitExpenses(metrics: DreMetrics): DreMetrics {
  const keys = ["impostos", "recLiq", "custVar", "margBruta", "margContr", "pessoal", "despOp", "ocupacao", "semCategoria", "totalFixos", "resOp", "recFin", "despFin", "recNaoOp", "despNaoOp", "lair", "irCsll", "lucroLiq", "pe", "margContPct"];
  return { ...metrics, ...Object.fromEntries(keys.map(k => [k, NaN])), expenseDetailsByPosition: {}, expenseIssues: [],
    resultState: { status: "unavailable", reasons: [...metrics.resultState.reasons, "Despesas do centro compartilhado sem atribuição aprovada por unidade; disponíveis somente no consolidado do conjunto integral."] } };
}
