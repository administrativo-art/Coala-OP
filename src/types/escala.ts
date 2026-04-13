// ─── Escala types ─────────────────────────────────────────────────────────────
// TODO: When integrating Firestore, these mirror the 'escalas' collection in
// the 'coalafinan' project. The `cor` field on Turno comes from the user profile.

export type Turno = {
  id: string
  funcionarioId: string
  nome: string
  iniciais: string
  horario: string
  tipo: 'OP' | 'ADM' | 'CXA'
  cor?: string           // hex color assigned in user profile
  alerta?: boolean
  alertaMsg?: string
}

export type DiaEscala = {
  data: Date
  turnos: Record<string, Turno[]>  // key = colunaId
}

export type ColunaEscala = {
  id: string
  nome: string
  iniciais: string
  tipo: 'OP' | 'ADM'
  cor: 'green' | 'blue' | 'amber'
}
