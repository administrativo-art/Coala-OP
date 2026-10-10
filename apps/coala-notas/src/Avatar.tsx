import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { colors } from "./theme";

const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toLocaleUpperCase("pt-BR")).join("") || "?";

/** Foto cadastrada no Coala One; sem foto, ou se ela não carregar, ficam as iniciais. */
export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (url && !failed) return <Image accessibilityLabel={`Foto de ${name}`} source={{ uri: url }} onError={() => setFailed(true)} style={[styles.image, shape]} />;
  return <View accessibilityLabel={name} style={[styles.fallback, shape]}><Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials(name)}</Text></View>;
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.border },
  fallback: { backgroundColor: "#8F6CC4", alignItems: "center", justifyContent: "center", experimental_backgroundImage: "linear-gradient(135deg, #F08BB1, #5B5BD6)" },
  initials: { color: "#FFFFFF", fontWeight: "800" },
});
