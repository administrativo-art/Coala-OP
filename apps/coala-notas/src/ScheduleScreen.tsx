import { useEffect, useMemo, useState } from "react";
import type { User } from "@firebase/auth";
import { ActivityIndicator, BackHandler, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Avatar } from "./Avatar";
import { isoToBrDate } from "./ItemStock";
import { createSimulationSchedule, loadMonthSchedule, monthKey, shiftDay, weekdayOf, weekOf, WEEKDAYS, type MonthSchedule, type ScheduleShift, type ScheduleUnit } from "./schedule";
import { FadeIn, ScreenHeader, ui } from "./ui";

// No tablet a semana inteira cabe como quadro (pessoas × dias); no celular, um dia por vez.
const GRID_WIDTH = 720;
const localToday = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; };
const shortDate = (iso: string) => isoToBrDate(iso).slice(0, 5);
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"] as const;
const LONG_WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
const longDate = (iso: string) => `${LONG_WEEKDAYS[weekdayOf(iso)]}, ${Number(iso.slice(8, 10))} de ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
// "6 a 12 de outubro"; quando a semana cruza o mês, cada ponta leva o seu.
const weekLabel = (week: string[]) => week[0]!.slice(5, 7) === week[6]!.slice(5, 7)
  ? `${Number(week[0]!.slice(8, 10))} a ${Number(week[6]!.slice(8, 10))} de ${MONTHS[Number(week[6]!.slice(5, 7)) - 1]}`
  : `${Number(week[0]!.slice(8, 10))} de ${MONTHS[Number(week[0]!.slice(5, 7)) - 1]} a ${Number(week[6]!.slice(8, 10))} de ${MONTHS[Number(week[6]!.slice(5, 7)) - 1]}`;
const hours = (shift: ScheduleShift) => shift.type === "day_off" ? "Folga" : `${shift.startTime}–${shift.endTime}`;

function Chips<T extends string>(props: { options: Array<{ id: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
    {props.options.map((option) => <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: props.value === option.id }} onPress={() => props.onChange(option.id)} style={[styles.chip, props.value === option.id && styles.chipOn]}><Text style={[styles.chipText, props.value === option.id && styles.chipTextOn]}>{option.label}</Text></Pressable>)}
  </ScrollView>;
}

/** Um dia: quem trabalha, por horário, e quem folga. */
function DayList({ unit, date, onlyMine }: { unit: ScheduleUnit; date: string; onlyMine: boolean }) {
  const shifts = unit.shifts.filter((shift) => shift.date === date && (!onlyMine || unit.people[shift.person]?.isMe))
    .sort((left, right) => Number(left.type === "day_off") - Number(right.type === "day_off") || left.startTime.localeCompare(right.startTime) || unit.people[left.person]!.name.localeCompare(unit.people[right.person]!.name, "pt-BR"));
  if (!shifts.length) return <Text style={styles.empty}>{onlyMine ? "Você não tem turno nem folga registrados neste dia." : "Ninguém escalado neste dia."}</Text>;
  return <View>{shifts.map((shift, index) => {
    const person = unit.people[shift.person]!;
    return <View key={`${shift.person}-${shift.startTime}-${index}`} style={[styles.line, styles.lineBorder]}>
      <View style={shift.type === "day_off" ? styles.lineOff : null}><Avatar name={person.name} url={person.avatarUrl} size={36} /></View>
      <View style={styles.fill}><Text numberOfLines={1} style={styles.personName}>{person.name}{person.isMe ? " (você)" : ""}</Text><Text numberOfLines={1} style={styles.meta}>{person.role}{shift.type === "work" ? ` · ${shift.shiftName}` : ""}</Text></View>
      <Text style={[styles.hours, shift.type === "day_off" && styles.hoursOff]}>{hours(shift)}</Text>
    </View>;
  })}</View>;
}

/** Quadro da semana para telas largas: uma linha por pessoa, uma coluna por dia. */
function WeekGrid({ unit, week, today, onlyMine }: { unit: ScheduleUnit; week: string[]; today: string; onlyMine: boolean }) {
  const byCell = new Map<string, ScheduleShift[]>();
  for (const shift of unit.shifts) byCell.set(`${shift.person}|${shift.date}`, [...(byCell.get(`${shift.person}|${shift.date}`) ?? []), shift]);
  return <View style={styles.panel}>
    <View style={styles.gridRow}><View style={styles.gridName} />{week.map((date) => <View key={date} style={styles.gridCell}><Text style={[styles.gridHead, date === today && styles.gridToday]}>{WEEKDAYS[weekdayOf(date)]} {date.slice(8, 10)}</Text></View>)}</View>
    {unit.people.map((person, index) => onlyMine && !person.isMe ? null : <View key={`${person.name}-${index}`} style={[styles.gridRow, styles.lineBorder]}>
      <View style={styles.gridName}><Avatar name={person.name} url={person.avatarUrl} size={30} /><Text numberOfLines={1} style={styles.gridPerson}>{person.name}</Text></View>
      {week.map((date) => {
        const cell = byCell.get(`${index}|${date}`) ?? [];
        return <View key={date} style={styles.gridCell}>{cell.length ? cell.map((shift, position) => <Text key={position} style={[styles.gridShift, shift.type === "day_off" && styles.hoursOff]}>{hours(shift)}</Text>) : <Text style={styles.gridNone}>—</Text>}</View>;
      })}
    </View>)}
  </View>;
}

/** Escala publicada das unidades em que a pessoa está lotada. Abre em hoje; a semana fica no topo para trocar de dia. */
export function ScheduleScreen({ user, simulation, onBack }: { user?: User; simulation: boolean; onBack: () => void }) {
  const { width } = useWindowDimensions();
  const grid = width >= GRID_WIDTH;
  const [today, setToday] = useState(localToday);
  const [date, setDate] = useState(localToday);
  const [months, setMonths] = useState<Record<string, MonthSchedule | "loading" | "error">>({});
  const [unitId, setUnitId] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const week = useMemo(() => weekOf(date), [date]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => subscription.remove();
  }, [onBack]);

  // Cada mês é lido uma vez por visita; a semana que cruza dois meses carrega os dois.
  useEffect(() => {
    for (const key of new Set([monthKey(week[0]!), monthKey(week[6]!)])) {
      if (months[key]) continue;
      const year = Number(key.slice(0, 4)); const month = Number(key.slice(5, 7));
      if (simulation || !user) { setMonths((current) => ({ ...current, [key]: createSimulationSchedule(year, month, today) })); continue; }
      setMonths((current) => ({ ...current, [key]: "loading" }));
      void loadMonthSchedule(user, year, month)
        .then((result) => { setMonths((current) => ({ ...current, [key]: result })); if (monthKey(result.today) === key) setToday(result.today); })
        .catch(() => setMonths((current) => ({ ...current, [key]: "error" })));
    }
  }, [week, user?.uid, simulation]);

  const current = months[monthKey(date)];
  const loaded = typeof current === "object" ? current : null;
  // A semana mostra turnos dos dois meses quando os dois já chegaram.
  const units = useMemo(() => {
    const merged = new Map<string, ScheduleUnit>();
    for (const key of new Set([monthKey(week[0]!), monthKey(week[6]!), monthKey(date)])) {
      const month = months[key];
      if (typeof month !== "object") continue;
      for (const unit of month.units) {
        const existing = merged.get(unit.id);
        if (!existing) { merged.set(unit.id, { ...unit, people: [...unit.people], shifts: [...unit.shifts] }); continue; }
        // As pessoas são numeradas por mês; reencaixa pelo nome ao juntar.
        const remap = unit.people.map((person) => { const found = existing.people.findIndex((other) => other.name === person.name && other.isMe === person.isMe); if (found >= 0) return found; existing.people.push(person); return existing.people.length - 1; });
        existing.shifts.push(...unit.shifts.map((shift) => ({ ...shift, person: remap[shift.person]! })));
      }
    }
    return [...merged.values()];
  }, [months, week, date]);
  const unit = units.find((candidate) => candidate.id === unitId) ?? units[0] ?? null;
  const myNext = useMemo(() => unit ? unit.shifts.filter((shift) => unit.people[shift.person]?.isMe && shift.date >= today).sort((left, right) => left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime)).slice(0, 14) : [], [unit, today]);

  // No celular, cada dia da faixa mostra a hora em que o meu turno começa (ou um traço na folga).
  const myStart = (key: string) => {
    const mine = unit?.shifts.find((shift) => shift.date === key && unit.people[shift.person]?.isMe && shift.type === "work");
    return mine ? `${mine.startTime.slice(0, 2)}h` : "—";
  };
  return <View style={styles.screen}>
    <ScreenHeader kicker={simulation ? "SIMULAÇÃO" : undefined} title="Escala" onBack={onBack} backLabel="Voltar para o início" />
    <ScrollView contentContainerStyle={[styles.content, grid && styles.contentWide]}>
      {units.length > 1 ? <Chips options={units.map((candidate) => ({ id: candidate.id, label: candidate.name }))} value={unit?.id ?? ""} onChange={setUnitId} /> : null}
      <View style={styles.weekBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Semana anterior" onPress={() => setDate(shiftDay(date, -7))} style={styles.arrow}><Text style={styles.arrowText}>‹</Text></Pressable>
        <Text style={styles.weekLabel}>{weekLabel(week)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Próxima semana" onPress={() => setDate(shiftDay(date, 7))} style={styles.arrow}><Text style={styles.arrowText}>›</Text></Pressable>
      </View>
      {!grid ? <View style={styles.days}>{week.map((key) => { const on = key === date; return <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setDate(key)} style={[styles.day, on && styles.dayOn]}>
        <Text style={[styles.dayName, on && styles.dayNameOn, key === today && !on && styles.dayNameToday]}>{WEEKDAYS[weekdayOf(key)]}</Text>
        <Text style={[styles.dayNumber, on && styles.dayTextOn]}>{Number(key.slice(8, 10))}</Text>
        <Text style={[styles.dayShift, on && styles.dayShiftOn, myStart(key) === "—" && !on && styles.dayShiftNone]}>{myStart(key)}</Text>
      </Pressable>; })}</View> : null}
      <View style={styles.toolbar}>
        <Chips options={[{ id: "all", label: "Equipe" }, { id: "mine", label: "Só a minha" }]} value={onlyMine ? "mine" : "all"} onChange={(value) => setOnlyMine(value === "mine")} />
        {date !== today ? <Pressable accessibilityRole="button" onPress={() => setDate(today)} hitSlop={8}><Text style={styles.link}>Ir para hoje</Text></Pressable> : null}
      </View>
      {current === "loading" || current === undefined ? <View style={styles.loading}><ActivityIndicator color={ui.accent} /><Text style={styles.meta}>Carregando escala…</Text></View> : null}
      {current === "error" ? <View style={styles.errorBox}><Text style={styles.error}>Não foi possível carregar a escala.</Text><Pressable accessibilityRole="button" onPress={() => setMonths((all) => { const next = { ...all }; delete next[monthKey(date)]; return next; })}><Text style={styles.link}>Tentar novamente</Text></Pressable></View> : null}
      {loaded && !loaded.published ? <Text style={styles.empty}>A escala deste mês ainda não foi publicada.</Text> : null}
      {loaded && loaded.published && !unit ? <Text style={styles.empty}>Você não está em nenhuma escala publicada neste mês.</Text> : null}
      {loaded && loaded.published && unit ? <FadeIn key={`${date}-${onlyMine}-${unit.id}`} style={styles.stack}>
        {grid ? <WeekGrid unit={unit} week={week} today={today} onlyMine={onlyMine} /> : <>
          <Text style={styles.section}>{longDate(date)}{date === today ? " · hoje" : ""}</Text>
          <DayList unit={unit} date={date} onlyMine={onlyMine} />
        </>}
        {onlyMine ? <>
          <Text style={styles.section}>Meus próximos dias</Text>
          {myNext.length ? <View>{myNext.map((shift, index) => <View key={`${shift.date}-${shift.startTime}-${index}`} style={[styles.line, styles.lineBorder]}>
            <Text style={styles.nextDay}>{shift.date === today ? "Hoje" : `${WEEKDAYS[weekdayOf(shift.date)]} ${shortDate(shift.date)}`}</Text>
            <Text style={[styles.hours, styles.fill, shift.type === "day_off" && styles.hoursOff]}>{hours(shift)}</Text>
            <Text style={styles.meta}>{shift.type === "work" ? shift.shiftName : ""}</Text>
          </View>)}</View> : <Text style={styles.empty}>Nenhum turno seu nos meses já carregados. Avance a semana para ver o próximo mês.</Text>}
        </> : null}
      </FadeIn> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, screen: { flex: 1, backgroundColor: ui.page }, content: { width: "100%", maxWidth: 600, alignSelf: "center", paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, gap: 10 }, contentWide: { maxWidth: 1040 }, stack: { gap: 10 },
  chips: { gap: 6, paddingRight: 8 }, chip: { borderWidth: 1, borderColor: ui.borderInput, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }, chipOn: { borderColor: ui.dark, backgroundColor: ui.dark }, chipText: { color: ui.inkMuted, fontSize: 12, fontWeight: "700" }, chipTextOn: { color: "#FFFFFF" },
  weekBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, weekLabel: { color: ui.ink, fontSize: 14.5, fontWeight: "800" },
  arrow: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.borderInput }, arrowText: { color: ui.ink, fontSize: 18, fontWeight: "700" },
  days: { flexDirection: "row", gap: 2, padding: 6, borderRadius: 16, backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border }, day: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 8, borderRadius: 12 }, dayOn: { backgroundColor: ui.dark },
  dayName: { color: ui.inkMuted, fontSize: 11, fontWeight: "800" }, dayNameOn: { color: ui.pink }, dayNameToday: { color: ui.accentInk }, dayNumber: { color: ui.ink, fontSize: 15, fontWeight: "800" }, dayTextOn: { color: "#FFFFFF" },
  dayShift: { color: ui.ink, fontSize: 10.5, fontWeight: "800" }, dayShiftOn: { color: ui.onDark2 }, dayShiftNone: { color: ui.disabled },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, link: { color: ui.accentInk, fontSize: 13, fontWeight: "800", paddingVertical: 6 }, section: { color: ui.ink, fontSize: 15, fontWeight: "800", marginTop: 4 },
  panel: { backgroundColor: ui.surface, borderRadius: 16, borderWidth: 1, borderColor: ui.border, paddingHorizontal: 14, paddingVertical: 6 },
  line: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }, lineBorder: { borderTopWidth: 1, borderTopColor: ui.border }, lineOff: { opacity: 0.55 },
  personName: { color: ui.ink, fontSize: 14, fontWeight: "800" }, meta: { color: ui.inkMuted, fontSize: 12 }, hours: { color: ui.ink, fontSize: 13.5, fontWeight: "800" }, hoursOff: { color: ui.inkFaint }, nextDay: { width: 92, color: ui.ink, fontSize: 13.5, fontWeight: "800", textTransform: "capitalize" },
  gridRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9 }, gridName: { width: 170, flexDirection: "row", alignItems: "center", gap: 8 }, gridPerson: { flex: 1, color: ui.ink, fontSize: 13, fontWeight: "800" },
  gridCell: { flex: 1, alignItems: "center", gap: 2 }, gridHead: { color: ui.inkMuted, fontSize: 12, fontWeight: "800", textTransform: "capitalize" }, gridToday: { color: ui.accentInk }, gridShift: { color: ui.ink, fontSize: 12, fontWeight: "800" }, gridNone: { color: ui.disabled, fontSize: 12 },
  empty: { color: ui.inkMuted, backgroundColor: ui.muted, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 }, loading: { alignItems: "center", gap: 8, paddingVertical: 28 },
  errorBox: { backgroundColor: ui.dangerBg, borderRadius: 12, padding: 14, gap: 4 }, error: { color: ui.danger, fontSize: 13, lineHeight: 19 },
});
