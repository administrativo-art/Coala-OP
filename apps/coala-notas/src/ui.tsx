import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors, contentColumn } from "./theme";

/** Cores do protótipo "Coala One App" que não existem no tema claro do sistema. */
export const ui = {
  dark: "#15151C", onDark: "#F3F2EE", onDark2: "#C8C7D0", onDarkSub: "#A9A8B3", onDarkFaint: "#8E8D99",
  pink: "#F08BB1", accent: "#D13670", accentInk: "#A6325B", accentSoft: "#FBE7EF", indigo: "#5B5BD6",
  line: "rgba(255,255,255,0.14)", field: "rgba(255,255,255,0.06)", fieldLine: "rgba(255,255,255,0.12)",
  page: "#F0EEE9", surface: "#FFFFFF", border: "#E3DFD6", borderInput: "#DCD9D1", muted: "#ECEAE5", soft: "#FAF9F6",
  ink: "#1A1B1F", inkMuted: "#5F646C", inkFaint: "#6E737A", disabled: "#B9B8C2",
  ok: "#147337", okBg: "#E8F5EE", warn: "#C2410C", warnBg: "#FFF1E6", info: "#1D4ED8", infoBg: "#EEF3FE", danger: "#BE123C", dangerBg: "#FFE4E8",
} as const;

/** Animação em laço entre 0 e 1; `useNativeDriver` mantém o movimento fora da thread de JS. */
function useLoop(duration: number, delay = 0) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: duration / 2, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [value, duration, delay]);
  return value;
}

/** Cada tela surge com um fade subindo 6px, como no protótipo. */
export function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(value, { toValue: 1, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }).start(); }, [value]);
  return <Animated.View style={[style, { opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>{children}</Animated.View>;
}

function Blob(props: { size: number; color: string; style: ViewStyle; drift: [number, number]; duration: number }) {
  const value = useLoop(props.duration);
  return <Animated.View pointerEvents="none" style={[styles.blob, props.style, { width: props.size, height: props.size, borderRadius: props.size / 2, backgroundColor: props.color,
    transform: [{ translateX: value.interpolate({ inputRange: [0, 1], outputRange: [0, props.drift[0]] }) }, { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, props.drift[1]] }) }] }]} />;
}

/** Fundo das telas escuras: manchas rosa e índigo desfocadas que derivam devagar. */
export function Aurora() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Blob size={220} color="rgba(209,54,112,0.55)" style={{ top: -60, right: -70 }} drift={[-50, 30]} duration={14000} />
    <Blob size={200} color="rgba(91,91,214,0.42)" style={{ top: 180, left: -90 }} drift={[60, 20]} duration={17000} />
    <Blob size={180} color="rgba(240,139,177,0.28)" style={{ bottom: 120, right: -40 }} drift={[-30, -25]} duration={12000} />
    <Blob size={160} color="rgba(91,91,214,0.30)" style={{ bottom: -40, left: 20 }} drift={[40, -20]} duration={19000} />
  </View>;
}

/** "Coala One": o "One" pulsa entre rosa e branco no lugar do gradiente corrido do protótipo. */
export function Brand({ size }: { size: number }) {
  const value = useLoop(4500);
  return <View style={styles.brand}>
    <Text style={[styles.brandText, { fontSize: size }]}>Coala</Text>
    <Animated.Text style={[styles.brandText, { fontSize: size, color: ui.pink, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) }]}>One</Animated.Text>
  </View>;
}

/** Slogan do login, com o brilho que passa aproximado por opacidade. Dois textos lado a lado: texto aninhado não anima no driver nativo. */
export function Slogan() {
  const value = useLoop(4500);
  return <View style={styles.sloganRow}>
    <Animated.Text style={[styles.slogan, styles.sloganStrong, { opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }]}>Acredite em você</Animated.Text>
    <Text style={styles.slogan}>, humano</Text>
  </View>;
}

export function BackButton({ onPress, label, disabled }: { onPress: () => void; label: string; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={6} style={[styles.back, disabled && styles.off]}><Text style={styles.backText}>←</Text></Pressable>;
}

/** Cabeçalho escuro com cantos inferiores arredondados; `children` recebe progresso, resumo ou filtros. */
export function ScreenHeader(props: { title: string; kicker?: string; onBack?: () => void; backLabel?: string; backDisabled?: boolean; right?: ReactNode; children?: ReactNode; flat?: boolean }) {
  return <View style={[styles.header, props.flat && styles.headerFlat]}><View style={styles.headerInner}>
    <View style={styles.headerRow}>
      {props.onBack ? <BackButton onPress={props.onBack} label={props.backLabel ?? "Voltar"} disabled={props.backDisabled} /> : null}
      <View style={styles.headerTitles}>
        {props.kicker ? <Text numberOfLines={1} style={styles.headerKicker}>{props.kicker}</Text> : null}
        <Text numberOfLines={1} style={styles.headerTitle}>{props.title}</Text>
      </View>
      {props.right}
    </View>
    {props.children}
  </View></View>;
}

export function HeaderAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.headerAction, disabled && styles.off]}><Text style={styles.headerActionText}>{label}</Text></Pressable>;
}

type PillTone = "info" | "warn" | "ok" | "accent" | "neutral";
const pillTones: Record<PillTone, { bg: string; fg: string }> = {
  info: { bg: ui.infoBg, fg: ui.info }, warn: { bg: ui.warnBg, fg: ui.warn }, ok: { bg: ui.okBg, fg: ui.ok }, accent: { bg: ui.accentSoft, fg: ui.accentInk }, neutral: { bg: ui.muted, fg: ui.inkMuted },
};
export function Pill({ label, tone = "info" }: { label: string; tone?: PillTone }) {
  return <View style={[styles.pill, { backgroundColor: pillTones[tone].bg }]}><Text style={[styles.pillText, { color: pillTones[tone].fg }]}>{label}</Text></View>;
}

/** Botão do protótipo: primário rosa ou secundário com contorno; `dark` é a versão sobre fundo escuro. */
export function AppButton(props: { label: string; onPress: () => void; secondary?: boolean; dark?: boolean; disabled?: boolean; compact?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!props.disabled }} disabled={props.disabled} onPress={props.onPress}
    style={({ pressed }) => [styles.button, props.compact && styles.buttonCompact, props.secondary ? (props.dark ? styles.buttonDarkSecondary : styles.buttonSecondary) : styles.buttonPrimary,
      props.disabled && (props.secondary ? styles.off : styles.buttonPrimaryOff), pressed && !props.disabled && styles.pressed]}>
    <Text style={[styles.buttonText, props.compact && styles.buttonTextCompact, props.secondary && (props.dark ? styles.buttonDarkSecondaryText : styles.buttonSecondaryText)]}>{props.label}</Text>
  </Pressable>;
}

/** Barra que enche da esquerda ao aparecer (metas, placar, etapas). */
export function FillBar(props: { percent: number; color?: string; track?: string; height?: number; delay?: number; children?: ReactNode }) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => { value.setValue(0); Animated.timing(value, { toValue: 1, duration: 1000, delay: props.delay ?? 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [value, props.percent, props.delay]);
  const width = Math.max(0, Math.min(props.percent, 100));
  return <View style={[styles.track, { height: props.height ?? 6, borderRadius: props.height ?? 6, backgroundColor: props.track ?? ui.border }]}>
    <Animated.View style={{ width: `${width}%`, height: "100%", borderRadius: props.height ?? 6, backgroundColor: props.color ?? ui.accent, transformOrigin: "left", transform: [{ scaleX: value }] }} />
    {props.children}
  </View>;
}

/** Véu de espera com anel girando e o texto da ação em curso. */
export function BusyOverlay({ text }: { text: string | null }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!text) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, text]);
  if (!text) return null;
  return <View accessibilityRole="progressbar" accessibilityLabel={text} style={styles.busy}>
    <Animated.View style={[styles.spinner, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }]} />
    <Text style={styles.busyText}>{text}</Text>
  </View>;
}

function Bob({ children, distance = 4, duration = 2600 }: { children: ReactNode; distance?: number; duration?: number }) {
  const value = useLoop(duration);
  return <Animated.View style={{ transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] }) }] }}>{children}</Animated.View>;
}

const stroke = (color: string) => ({ fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

/** Nota flutuando, com a linha de leitura passando e o ✓ subindo: o ícone grande de Compra local. */
export function PurchaseArt() {
  const scan = useLoop(2400);
  return <Bob duration={3200}><View style={styles.receipt}>
    {[38, 28, 34, 20].map((width, index) => <View key={index} style={{ height: 4, width, borderRadius: 3, backgroundColor: index === 3 ? ui.accent : ui.border }} />)}
    <Animated.View style={[styles.scan, { transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [0, 56] }) }] }]} />
    <Animated.View style={[styles.receiptCheck, { opacity: scan, transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}><Text style={styles.receiptCheckText}>✓</Text></Animated.View>
  </View></Bob>;
}

export function StockIcon() {
  return <Bob><Svg width={26} height={26} viewBox="0 0 24 24" {...stroke(ui.indigo)}><Path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><Path d="m3.3 7 8.7 5 8.7-5" /><Path d="M12 22V12" /></Svg></Bob>;
}

export function TruckIcon() {
  const value = useLoop(3600);
  return <Animated.View style={{ transform: [{ translateX: value.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) }] }}><Svg width={26} height={26} viewBox="0 0 24 24" {...stroke(ui.warn)}>
    <Path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><Path d="M15 18H9" /><Path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14" /><Circle cx={17} cy={18} r={2} /><Circle cx={7} cy={18} r={2} />
  </Svg></Animated.View>;
}

function GrowBar({ height, delay, color }: { height: number; delay: number; color: string }) {
  const value = useLoop(2400, delay);
  return <Animated.View style={{ width: 6, height, borderRadius: 2, backgroundColor: color, transformOrigin: "bottom", transform: [{ scaleY: value.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }] }} />;
}
export function GoalsIcon() {
  return <View style={styles.bars}><GrowBar height={10} delay={0} color={ui.pink} /><GrowBar height={16} delay={200} color={ui.pink} /><GrowBar height={22} delay={400} color={ui.accent} /></View>;
}

/** Monitor com a mídia "passando": o ícone do Signage. */
export function SignageIcon() {
  const value = useLoop(2800);
  return <View><Svg width={26} height={26} viewBox="0 0 24 24" {...stroke(ui.accent)}><Rect x={2} y={4} width={20} height={13} rx={2} /><Path d="M8 21h8" /><Path d="M12 17v4" /></Svg>
    <Animated.View style={[styles.signagePulse, { opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }]} /></View>;
}

export function ScheduleIcon() {
  const value = useLoop(3000);
  return <View><Svg width={26} height={26} viewBox="0 0 24 24" {...stroke(ui.info)}><Rect x={3} y={4} width={18} height={18} rx={3} /><Path d="M16 2v4" /><Path d="M8 2v4" /><Path d="M3 10h18" /></Svg>
    <Animated.View style={[styles.hop, { transform: [{ translateX: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -7, -7] }) }, { translateY: value.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, -5] }) }] }]} /></View>;
}

export function BiometricIcon() {
  return <Bob duration={2400}><Svg width={34} height={34} viewBox="0 0 24 24" {...stroke(ui.pink)}>
    <Path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /><Path d="M14 13.12c0 2.38 0 6.38-1 8.88" /><Path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /><Path d="M2 12a10 10 0 0 1 18-6" /><Path d="M2 16h.01" /><Path d="M21.8 16c.2-2 .131-5.354 0-6" /><Path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /><Path d="M8.65 22c.21-.66.45-1.32.57-2" /><Path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  </Svg></Bob>;
}

const styles = StyleSheet.create({
  blob: { position: "absolute", filter: [{ blur: 38 }] },
  brand: { flexDirection: "row", gap: 6, alignItems: "baseline" }, brandText: { color: ui.onDark, fontWeight: "800", letterSpacing: -0.8 },
  slogan: { color: ui.onDark2, fontSize: 16, fontWeight: "600" }, sloganStrong: { color: ui.pink, fontWeight: "700" }, sloganRow: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap" },
  back: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, borderColor: ui.line, alignItems: "center", justifyContent: "center" }, backText: { color: ui.onDark2, fontSize: 16 },
  header: { backgroundColor: ui.dark, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }, headerFlat: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  headerInner: { ...contentColumn, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18, gap: 14 }, headerRow: { flexDirection: "row", alignItems: "center", gap: 12 }, headerTitles: { flex: 1, gap: 1 },
  headerKicker: { color: ui.onDarkFaint, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 }, headerTitle: { color: ui.onDark, fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  headerAction: { height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: ui.line, alignItems: "center", justifyContent: "center" }, headerActionText: { color: ui.onDark, fontSize: 12.5, fontWeight: "700" },
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }, pillText: { fontSize: 11, fontWeight: "800" },
  button: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }, buttonCompact: { height: 48, borderRadius: 13 },
  buttonPrimary: { backgroundColor: ui.accent }, buttonPrimaryOff: { backgroundColor: ui.disabled }, buttonSecondary: { backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.borderInput }, buttonDarkSecondary: { borderWidth: 1, borderColor: ui.line },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800", textAlign: "center" }, buttonTextCompact: { fontSize: 14.5 }, buttonSecondaryText: { color: ui.ink, fontWeight: "700" }, buttonDarkSecondaryText: { color: ui.onDark, fontWeight: "700" },
  off: { opacity: 0.5 }, pressed: { opacity: 0.86 }, track: { overflow: "hidden", flexDirection: "row" },
  busy: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 5, backgroundColor: "rgba(21,21,28,0.72)", alignItems: "center", justifyContent: "center", gap: 14 },
  spinner: { width: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: "rgba(255,255,255,0.18)", borderTopColor: ui.pink }, busyText: { color: ui.onDark, fontSize: 15, fontWeight: "800" },
  receipt: { width: 62, height: 84, borderRadius: 8, backgroundColor: "#FFFFFF", paddingVertical: 12, paddingHorizontal: 10, gap: 6, shadowColor: ui.accentInk, shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  scan: { position: "absolute", left: -6, right: -6, top: 12, height: 2, borderRadius: 2, backgroundColor: ui.accent },
  receiptCheck: { position: "absolute", right: -10, top: -10, width: 22, height: 22, borderRadius: 11, backgroundColor: ui.ok, alignItems: "center", justifyContent: "center" }, receiptCheckText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 24 }, hop: { position: "absolute", left: 14, top: 14, width: 6, height: 6, borderRadius: 2, backgroundColor: ui.accent },
  signagePulse: { position: "absolute", left: 7, top: 8, width: 12, height: 5, borderRadius: 2, backgroundColor: ui.pink },
});

export { colors };
