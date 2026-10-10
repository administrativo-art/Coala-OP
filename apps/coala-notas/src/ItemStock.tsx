import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { colors } from "./theme";
import type { StockProduct } from "./upload";

/** Entrada no estoque de um item da nota; `productId` nulo significa consumo direto. */
export type ItemStock = { productId: string | null; quantity: string; expiry: string; noExpiry: boolean };

export const emptyItemStock: ItemStock = { productId: null, quantity: "", expiry: "", noExpiry: false };

/** DD/MM/AAAA digitado pelo operador → AAAA-MM-DD, ou null se a data não existir. */
export function expiryToIso(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${iso}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/** AAAA-MM-DD do servidor → DD/MM/AAAA para exibir e editar. */
export function isoToBrDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

export function maskDate(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join("/");
}

export function ItemStockEditor(props: { value: ItemStock; products: StockProduct[]; suggested: boolean; onChange: (next: ItemStock) => void }) {
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState("");
  const product = props.products.find((candidate) => candidate.id === props.value.productId) ?? null;
  const matches = useMemo(() => {
    const words = term.trim().toLocaleLowerCase("pt-BR").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return props.products.filter((candidate) => words.every((word) => candidate.name.toLocaleLowerCase("pt-BR").includes(word))).slice(0, 12);
  }, [props.products, term]);

  if (!props.products.length) return null;
  if (searching) return <View style={styles.box}>
    <TextInput autoFocus value={term} onChangeText={setTerm} placeholder="Buscar produto do estoque" style={styles.input} />
    {term.trim() && !matches.length ? <Text style={styles.hint}>Nenhum produto encontrado. Sem cadastro, o item fica como consumo direto.</Text> : null}
    {matches.map((candidate) => <Pressable key={candidate.id} accessibilityRole="button" onPress={() => { props.onChange({ ...props.value, productId: candidate.id }); setSearching(false); setTerm(""); }} style={styles.match}><Text style={styles.matchText}>{candidate.name}</Text></Pressable>)}
    <Pressable accessibilityRole="button" onPress={() => { setSearching(false); setTerm(""); }}><Text style={styles.link}>Cancelar</Text></Pressable>
  </View>;

  if (!product) return <View style={styles.box}>
    <Text style={styles.title}>Consumo direto</Text>
    <Text style={styles.hint}>Este item não entra no estoque.</Text>
    <Pressable accessibilityRole="button" onPress={() => setSearching(true)}><Text style={styles.link}>Vincular a um produto do estoque</Text></Pressable>
  </View>;

  return <View style={[styles.box, styles.boxStock]}>
    <Text style={styles.kicker}>ENTRA NO ESTOQUE{props.suggested ? " · SUGESTÃO, CONFIRA" : ""}</Text>
    <Text style={styles.title}>{product.name}</Text>
    <View style={styles.row}>
      <View style={styles.flex}><Text style={styles.label}>Quantidade ({product.packageLabel})</Text><TextInput value={props.value.quantity} onChangeText={(quantity) => props.onChange({ ...props.value, quantity })} keyboardType="decimal-pad" placeholder="0" style={styles.input} /></View>
      <View style={styles.flex}><Text style={styles.label}>Validade</Text><TextInput editable={!props.value.noExpiry} value={props.value.noExpiry ? "" : props.value.expiry} onChangeText={(expiry) => props.onChange({ ...props.value, expiry: maskDate(expiry) })} keyboardType="number-pad" placeholder={props.value.noExpiry ? "Sem validade" : "DD/MM/AAAA"} style={[styles.input, props.value.noExpiry && styles.inputOff]} /></View>
    </View>
    <View style={styles.actions}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: props.value.noExpiry }} onPress={() => props.onChange({ ...props.value, noExpiry: !props.value.noExpiry })}><Text style={styles.link}>{props.value.noExpiry ? "Informar validade" : "Produto sem validade"}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setSearching(true)}><Text style={styles.link}>Trocar produto</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => props.onChange({ ...emptyItemStock })}><Text style={styles.linkDanger}>Não entra no estoque</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, backgroundColor: colors.mutedSurface, padding: 12, gap: 6 }, boxStock: { backgroundColor: colors.okBg },
  kicker: { color: colors.ok, fontSize: 10, fontWeight: "900", letterSpacing: 1 }, title: { color: colors.ink, fontSize: 14, fontWeight: "800" }, hint: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  label: { color: colors.inkMuted, fontSize: 11, fontWeight: "800", marginBottom: 4 }, row: { flexDirection: "row", gap: 8 }, flex: { flex: 1 },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.borderInput, backgroundColor: colors.surface, borderRadius: 11, paddingHorizontal: 12, color: colors.ink, fontSize: 15 }, inputOff: { backgroundColor: colors.mutedSurface },
  actions: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 2 }, link: { color: colors.accentInk, fontSize: 13, fontWeight: "800", paddingVertical: 6 }, linkDanger: { color: colors.danger, fontSize: 13, fontWeight: "800", paddingVertical: 6 },
  match: { borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 11 }, matchText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
});
