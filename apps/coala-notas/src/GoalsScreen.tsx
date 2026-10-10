import { useEffect, useState } from "react";
import type { User } from "@firebase/auth";
import { ActivityIndicator, BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Avatar } from "./Avatar";
import { createSimulationUnitGoals, formatMoney, loadGoalUnits, loadUnitGoals, simulationGoalUnits, type GoalUnit, type UnitGoal, type UnitGoals } from "./goals";
import { isoToBrDate } from "./ItemStock";
import { colors } from "./theme";
import { FadeIn, FillBar, ScreenHeader, ui } from "./ui";

type Tab = "days" | "team" | "prize";
const TABS: Array<{ id: Tab; label: string }> = [{ id: "days", label: "Dias" }, { id: "team", label: "Equipe" }, { id: "prize", label: "Prêmio" }];
const ROLE_LABELS = { fixed: null, relief: "Folguista", leader: "Liderança" } as const;
// A partir desta largura (tablet) as partes cabem lado a lado e as abas deixam de ser necessárias.
const TWO_COLUMN_WIDTH = 720;
const shortDate = (iso: string) => isoToBrDate(iso).slice(0, 5);

function Chips<T extends string>(props: { options: Array<{ id: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
    {props.options.map((option) => <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: props.value === option.id }} onPress={() => props.onChange(option.id)} style={[styles.chip, props.value === option.id && styles.chipOn]}><Text style={[styles.chipText, props.value === option.id && styles.chipTextOn]}>{option.label}</Text></Pressable>)}
  </ScrollView>;
}

/** Resumo dentro do cabeçalho escuro: quanto a unidade fez, onde estão os níveis e o que falta. */
function Summary({ goal, unitName }: { goal: UnitGoal; unitName: string }) {
  const { summary } = goal;
  const scale = Math.max(summary.levels.at(-1)?.amount ?? 0, summary.currentValue, 1);
  return <FadeIn key={goal.id} style={styles.summary}>
    <View><Text style={styles.heroKicker}>{unitName.toUpperCase()} · {goal.typeLabel.toUpperCase()}</Text><Text style={styles.heroPeriod}>{shortDate(goal.startDate)} a {shortDate(goal.endDate)} · dia {summary.elapsedDays} de {summary.totalDays}</Text></View>
    <View style={styles.heroRow}><Text style={styles.heroValue}>{formatMoney(summary.currentValue)}</Text><Text style={styles.heroPercent}>{Math.round(summary.percentOfTarget)}%</Text></View>
    <FillBar percent={(summary.currentValue / scale) * 100} color={ui.pink} track="#34343F" height={12}>
      {summary.levels.map((level) => <View key={level.id} style={[styles.marker, { left: `${Math.min((level.amount / scale) * 100, 100)}%` }]} />)}
    </FillBar>
    <View style={styles.levels}>{summary.levels.map((level) => <View key={level.id} style={styles.level}>
      <Text style={[styles.levelLabel, level.reached && styles.levelReached]}>{level.reached ? "✓ " : ""}{level.label}</Text>
      <Text style={styles.levelAmount}>{formatMoney(level.amount)}</Text>
    </View>)}</View>
    <Text style={styles.heroFact}>{summary.nextLevel ? `Faltam ${formatMoney(summary.nextLevel.remaining)} para ${summary.nextLevel.label}` : "Todos os níveis batidos"}</Text>
    {summary.neededDaily !== null && summary.nextLevel ? <Text style={styles.heroFact}>Precisa de {formatMoney(summary.neededDaily)} por dia nos {summary.remainingDays} dias restantes</Text> : null}
    {summary.projection !== null ? <Text style={styles.heroFact}>No ritmo atual, fecha em {formatMoney(summary.projection)}</Text> : null}
  </FadeIn>;
}

function Days({ goal, today }: { goal: UnitGoal; today: string }) {
  if (!goal.days.length) return <Text style={styles.empty}>O período ainda não começou.</Text>;
  return <>
    {goal.summary.dailyTarget !== null ? <Text style={styles.panelHint}>Meta por dia: {formatMoney(goal.summary.dailyTarget)}</Text> : null}
    <View style={styles.list}>{goal.days.map((day, index) => {
      const isToday = day.date === today;
      return <View key={day.date} style={[styles.line, index > 0 && styles.lineBorder]}>
        <Text style={styles.lineLabel}>{WEEKDAYS[new Date(`${day.date}T12:00:00Z`).getUTCDay()]} {shortDate(day.date)}</Text>
        {isToday ? <View style={styles.todayPill}><Text style={styles.todayText}>hoje</Text></View> : null}
        <Text style={styles.lineValue}>{formatMoney(day.value)}</Text>
        <Text style={[styles.lineMark, isToday ? styles.markToday : day.reachedDailyTarget ? styles.up : styles.markOff]}>{isToday ? "…" : day.reachedDailyTarget ? "✓" : "·"}</Text>
      </View>;
    })}</View>
  </>;
}

function Team({ goal }: { goal: UnitGoal }) {
  if (!goal.team.length) return <Text style={styles.empty}>Esta meta não tem metas individuais.</Text>;
  return <View style={styles.list}>{goal.team.map((person, index) => <View key={`${person.name}-${index}`} style={[styles.person, index > 0 && styles.lineBorder]}>
    <View style={styles.personHead}>
      <Avatar name={person.name} url={person.avatarUrl} size={30} />
      <Text numberOfLines={1} style={styles.personName}>{person.name}{person.isMe ? " (você)" : ""}</Text>
      <Text style={styles.personPercent}>{Math.round(person.percent)}%</Text>
    </View>
    <FillBar percent={person.percent} color={person.percent >= 100 ? ui.ok : ui.accent} delay={index * 80} />
    <Text style={styles.panelHint}>{formatMoney(person.currentValue)} de {formatMoney(person.targetValue)}{ROLE_LABELS[person.role] ? ` · ${ROLE_LABELS[person.role]}` : ""}</Text>
    {person.prize !== null ? <Text style={styles.personPrize}>Prêmio previsto: {formatMoney(person.prize, true)}</Text> : null}
  </View>)}</View>;
}

function Prize({ goal }: { goal: UnitGoal }) {
  const prize = goal.prize;
  if (!prize) return <Text style={styles.empty}>Esta meta não tem premiação por faixas.</Text>;
  return <View style={styles.panel}>
    <Text style={styles.prizeTotal}>{formatMoney(prize.totalTeamBonus, true)}</Text>
    <Text style={styles.panelHint}>Prêmio previsto da equipe{prize.leadershipBonus > 0 ? ` · liderança: ${formatMoney(prize.leadershipBonus, true)}` : ""}</Text>
    <Text style={styles.panelHint}>{prize.highestTierLabel ? `Faixa atual: ${prize.highestTierLabel}` : "Nenhuma faixa atingida ainda"}{prize.nextTier ? ` · faltam ${formatMoney(prize.nextTier.remaining)} para ${prize.nextTier.label}` : ""}</Text>
    {prize.message ? <Text style={styles.prizeMessage}>{prize.message}</Text> : null}
    {prize.tiers.map((tier) => { const current = prize.highestTierLabel === tier.label; return <View key={tier.label} style={[styles.tier, current && styles.tierOn]}>
      <View style={[styles.tierDot, tier.reached && styles.tierDotOn]}><Text style={styles.tierDotText}>{tier.reached ? "✓" : ""}</Text></View>
      <View style={styles.fill}><Text style={styles.tierLabel}>{tier.label}</Text><Text style={styles.panelHint}>a partir de {formatMoney(tier.fromAmount)}</Text><Text style={styles.panelHint}>{formatMoney(tier.fixedBonusAmount, true)} fixo{tier.excessPercent > 0 ? ` + ${String(tier.excessPercent).replace(".", ",")}% do que passar` : ""}</Text></View>
    </View>; })}
    <Text style={styles.footnote}>Previsão com o faturamento de hoje. O valor final é apurado no encerramento da meta e o de cada pessoa está na aba Equipe.</Text>
  </View>;
}

/** Metas em andamento das unidades do usuário: resumo no topo e, no celular, uma parte por vez em abas. */
export function GoalsScreen({ user, simulation, onBack }: { user?: User; simulation: boolean; onBack: () => void }) {
  const { width } = useWindowDimensions();
  const twoColumns = width >= TWO_COLUMN_WIDTH;
  const [units, setUnits] = useState<GoalUnit[] | null>(simulation ? simulationGoalUnits : null);
  const [unitId, setUnitId] = useState<string | null>(simulation ? simulationGoalUnits[0]!.id : null);
  const [data, setData] = useState<UnitGoals | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("days");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => subscription.remove();
  }, [onBack]);

  useEffect(() => {
    if (simulation || !user) return;
    void loadGoalUnits(user)
      .then((result) => { setUnits(result.units); setUnitId((current) => current ?? result.units[0]?.id ?? null); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Não foi possível carregar as unidades."));
  }, [user?.uid, simulation]);

  async function loadGoals(target: string) {
    setError(null);
    try {
      const result = simulation || !user ? createSimulationUnitGoals() : await loadUnitGoals(user, target);
      setData(result); setGoalId((current) => result.goals.some((goal) => goal.id === current) ? current : result.goals[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar as metas."); }
  }
  useEffect(() => {
    if (!unitId) return;
    setData(null); setLoading(true);
    void loadGoals(unitId).finally(() => setLoading(false));
  }, [unitId]);

  const unitName = units?.find((unit) => unit.id === unitId)?.name ?? "";
  const goal = data?.goals.find((candidate) => candidate.id === goalId) ?? data?.goals[0] ?? null;

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={() => { if (!unitId) return; setRefreshing(true); void loadGoals(unitId).finally(() => setRefreshing(false)); }} />;
  return <View style={styles.screen}>
    <ScreenHeader kicker={simulation ? "SIMULAÇÃO" : undefined} title="Metas" onBack={onBack} backLabel="Voltar para o início">
      {/* Quem atua em mais de uma unidade troca aqui; cada unidade tem a própria meta e a própria equipe. */}
      {units && units.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitChips}>{units.map((unit) => <Pressable key={unit.id} accessibilityRole="tab" accessibilityState={{ selected: unit.id === unitId }} onPress={() => setUnitId(unit.id)} style={[styles.unitChip, unit.id === unitId && styles.unitChipOn]}><Text style={[styles.unitChipText, unit.id === unitId && styles.unitChipTextOn]}>{unit.name}</Text></Pressable>)}</ScrollView> : null}
      {goal && !loading ? <Summary goal={goal} unitName={unitName} /> : null}
    </ScreenHeader>
    <ScrollView contentContainerStyle={[styles.content, twoColumns && styles.contentWide]} refreshControl={refreshControl}>
      {data && data.goals.length > 1 ? <Chips options={data.goals.map((candidate) => ({ id: candidate.id, label: candidate.typeLabel }))} value={goal?.id ?? ""} onChange={setGoalId} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {units && !units.length ? <Text style={styles.empty}>Sua conta não tem unidade liberada para ver metas.</Text> : null}
      {loading || (!units && !error) ? <View style={styles.loading}><ActivityIndicator color={ui.accent} /><Text style={styles.panelHint}>Carregando metas…</Text></View> : null}
      {data && !data.goals.length && !loading ? <Text style={styles.empty}>Nenhuma meta em andamento em {unitName}. Puxe para atualizar.</Text> : null}
      {goal && !loading ? (twoColumns
        ? <View style={styles.columns}>
          <View style={styles.column}><Text style={styles.section}>Dias</Text><Days goal={goal} today={data!.today} /></View>
          <View style={styles.column}><Text style={styles.section}>Equipe</Text><Team goal={goal} /><Text style={styles.section}>Prêmio</Text><Prize goal={goal} /></View>
        </View>
        : <>
          <View style={styles.segmented}>{TABS.map((option) => <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: tab === option.id }} onPress={() => setTab(option.id)} style={[styles.segment, tab === option.id && styles.segmentOn]}><Text style={[styles.segmentText, tab === option.id && styles.segmentTextOn]}>{option.label}</Text></Pressable>)}</View>
          <FadeIn key={tab} style={styles.tabBody}>{tab === "days" ? <Days goal={goal} today={data!.today} /> : tab === "team" ? <Team goal={goal} /> : <Prize goal={goal} />}</FadeIn>
        </>) : null}
    </ScrollView>
  </View>;
}

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const styles = StyleSheet.create({
  fill: { flex: 1 }, screen: { flex: 1, backgroundColor: ui.page }, content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, gap: 10 }, contentWide: { maxWidth: 1040 },
  columns: { flexDirection: "row", gap: 16, alignItems: "flex-start" }, column: { flex: 1, gap: 10 }, section: { color: ui.ink, fontSize: 15, fontWeight: "800", marginTop: 4 }, tabBody: { gap: 10 },
  unitChips: { gap: 6, paddingRight: 8 }, unitChip: { height: 32, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: ui.line, justifyContent: "center" }, unitChipOn: { borderColor: ui.pink, backgroundColor: "rgba(240,139,177,0.16)" }, unitChipText: { color: ui.onDark2, fontSize: 12.5, fontWeight: "700" }, unitChipTextOn: { color: "#FFFFFF" },
  chips: { gap: 6, paddingRight: 8 }, chip: { borderWidth: 1, borderColor: ui.borderInput, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: ui.surface }, chipOn: { borderColor: ui.dark, backgroundColor: ui.dark }, chipText: { color: ui.inkMuted, fontSize: 12.5, fontWeight: "700" }, chipTextOn: { color: "#FFFFFF" },
  summary: { gap: 8 }, heroKicker: { color: ui.pink, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 }, heroPeriod: { color: ui.onDark2, fontSize: 12, marginTop: 2 },
  heroRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }, heroValue: { color: ui.onDark, fontSize: 32, fontWeight: "900", letterSpacing: -0.9 }, heroPercent: { color: ui.onDark, fontSize: 20, fontWeight: "900" },
  marker: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -2, backgroundColor: "#FFFFFF" },
  levels: { flexDirection: "row", gap: 8 }, level: { flex: 1, gap: 2 }, levelLabel: { color: ui.onDark2, fontSize: 11, fontWeight: "900" }, levelReached: { color: "#7EE2A8" }, levelAmount: { color: ui.onDark, fontSize: 13, fontWeight: "700" }, heroFact: { color: ui.onDark2, fontSize: 12.5, lineHeight: 18 },
  segmented: { flexDirection: "row", gap: 4, padding: 3, borderRadius: 12, backgroundColor: "#E6E3DC" }, segment: { flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" }, segmentOn: { backgroundColor: ui.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 }, segmentText: { color: ui.inkMuted, fontSize: 13, fontWeight: "700" }, segmentTextOn: { color: ui.ink, fontWeight: "800" },
  list: { backgroundColor: ui.surface, borderRadius: 16, borderWidth: 1, borderColor: ui.border, paddingVertical: 2, paddingHorizontal: 14 }, panel: { backgroundColor: ui.surface, borderRadius: 16, borderWidth: 1, borderColor: ui.border, padding: 14, gap: 10 }, panelHint: { color: ui.inkMuted, fontSize: 12.5, lineHeight: 18 },
  line: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 }, lineBorder: { borderTopWidth: 1, borderTopColor: ui.border }, lineLabel: { width: 76, color: ui.ink, fontSize: 13.5, fontWeight: "800" }, lineValue: { flex: 1, color: ui.ink, fontSize: 14.5, fontWeight: "700", textAlign: "right", fontVariant: ["tabular-nums"] }, lineMark: { width: 18, fontSize: 13, fontWeight: "900", textAlign: "center" },
  todayPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: ui.accentSoft }, todayText: { color: ui.accentInk, fontSize: 10.5, fontWeight: "800" }, up: { color: ui.ok }, markToday: { color: ui.inkFaint }, markOff: { color: ui.disabled },
  person: { gap: 5, paddingVertical: 10 }, personHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, personName: { flex: 1, color: ui.ink, fontSize: 15, fontWeight: "800" }, personPercent: { color: ui.ink, fontSize: 15, fontWeight: "800" }, personPrize: { color: ui.accentInk, fontSize: 13, fontWeight: "800" },
  prizeTotal: { color: ui.ink, fontSize: 30, fontWeight: "900", letterSpacing: -0.9 }, prizeMessage: { color: colors.alertInk, backgroundColor: colors.alertBg, borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 19 },
  tier: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: ui.border, backgroundColor: ui.soft }, tierOn: { borderWidth: 2, borderColor: ui.accent, backgroundColor: ui.accentSoft, padding: 11 },
  tierDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: ui.muted, alignItems: "center", justifyContent: "center" }, tierDotOn: { backgroundColor: ui.okBg }, tierDotText: { color: ui.ok, fontSize: 12, fontWeight: "900" }, tierLabel: { color: ui.ink, fontSize: 14, fontWeight: "800" },
  footnote: { color: ui.inkFaint, fontSize: 11.5, lineHeight: 17 },
  error: { color: ui.danger, backgroundColor: ui.dangerBg, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 }, empty: { color: ui.inkMuted, backgroundColor: ui.muted, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 }, loading: { alignItems: "center", gap: 8, paddingVertical: 28 },
});
