import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "./theme";
import { formatCents, formatDay, type OpenWithdrawal } from "./upload";

export function withdrawalLabel(withdrawal: OpenWithdrawal) {
  return `${withdrawal.unitName} · ${formatDay(withdrawal.date)}${withdrawal.time ? ` às ${withdrawal.time}` : ""}`;
}

export function WithdrawalList(props: {
  withdrawals: OpenWithdrawal[] | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
  partial: boolean;
  since: string | null;
  onSelect: (withdrawal: OpenWithdrawal) => void;
  onRefresh: () => void;
}) {
  const count = props.withdrawals?.length ?? 0;
  return <View style={styles.section}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.title}>Sangrias aguardando nota</Text>
        <Text style={styles.subtitle}>{props.since ? `Registradas no PDV desde ${formatDay(props.since)}` : "Registradas no PDV"}</Text>
      </View>
      {props.loading ? <ActivityIndicator color={colors.accent} /> : <Pressable accessibilityRole="button" disabled={props.offline} onPress={props.onRefresh} style={styles.refresh}><Text style={styles.refreshText}>Atualizar</Text></Pressable>}
    </View>
    {props.offline ? <Text style={styles.empty}>Sem internet. A lista de sangrias volta quando a conexão retornar.</Text>
      : props.error ? <Text style={styles.error}>{props.error}</Text>
        : props.withdrawals === null ? <Text style={styles.empty}>Consultando o PDV…</Text>
          : !count ? <Text style={styles.empty}>Nenhuma sangria pendente. Toda sangria do período já tem nota.</Text> : null}
    {props.withdrawals?.map((withdrawal) => <Pressable key={withdrawal.sourceId} accessibilityRole="button" onPress={() => props.onSelect(withdrawal)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardText}>
        <Text style={styles.amount}>{formatCents(withdrawal.amountCents)}</Text>
        <Text style={styles.meta}>{withdrawalLabel(withdrawal)}</Text>
        {withdrawal.operatorName ? <Text style={styles.meta}>{withdrawal.operatorName}</Text> : null}
      </View>
      <Text style={styles.action}>Anexar nota ›</Text>
    </Pressable>)}
    {props.partial && !props.error ? <Text style={styles.partial}>O PDV não respondeu para todos os dias. Toque em Atualizar para tentar de novo.</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, headerText: { flex: 1, gap: 1 },
  title: { color: "#1A1B1F", fontSize: 17, fontWeight: "800" }, subtitle: { color: colors.inkMuted, fontSize: 12 },
  refresh: { height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.borderInput, backgroundColor: colors.surface, justifyContent: "center" }, refreshText: { color: colors.ink, fontSize: 12.5, fontWeight: "700" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, paddingHorizontal: 16 }, cardPressed: { opacity: 0.86 }, cardText: { flex: 1, gap: 2 },
  amount: { color: colors.ink, fontSize: 20, fontWeight: "800", letterSpacing: -0.4 }, meta: { color: colors.inkMuted, fontSize: 12.5 }, action: { color: colors.accentInk, fontSize: 13, fontWeight: "800" },
  empty: { color: colors.inkMuted, backgroundColor: "#ECEAE5", borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, backgroundColor: colors.dangerBg, borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 19 },
  partial: { color: colors.alertInk, backgroundColor: colors.alertBg, borderRadius: 12, padding: 12, fontSize: 12, lineHeight: 18 },
});
