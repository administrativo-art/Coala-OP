// Stone WalletNatureId and WalletTypeId:
// https://conciliacao.stone.com.br/reference/walletnatureid
// https://conciliacao.stone.com.br/reference/wallettypeid
export const walletNatureLabels = {
  regular: "Carteira normal", warranty: "Garantia", ownership_assignment: "Cessão",
  stone_anticipation: "Antecipação Stone", unknown: "Natureza não reconhecida",
} as const;

export const walletTypeLabels: Record<string, string> = {
  "1": "Movimentos não transacionais",
  "2": "Visa débito", "3": "Visa crédito", "4": "Visa antecipação",
  "5": "Mastercard débito", "6": "Mastercard crédito", "7": "Mastercard antecipação",
  "8": "Hiper débito", "9": "Hiper crédito", "10": "Hiper antecipação",
  "11": "Elo débito", "12": "Elo crédito", "13": "Elo antecipação",
  "14": "American Express débito", "15": "American Express crédito", "16": "American Express antecipação",
  "17": "Boleto",
  "20": "Cabal débito", "21": "Cabal crédito", "22": "Cabal antecipação",
  "23": "UnionPay débito", "24": "UnionPay crédito", "25": "UnionPay antecipação",
  "26": "Visa débito antecipação", "27": "Mastercard débito antecipação",
  "28": "Elo débito antecipação", "29": "Cabal débito antecipação",
  "30": "UnionPay débito antecipação",
  "31": "Elo voucher crédito", "32": "Elo voucher antecipação",
  "33": "Mastercard voucher crédito", "34": "Mastercard voucher antecipação",
  "35": "Visa voucher crédito", "36": "Visa voucher antecipação",
};
