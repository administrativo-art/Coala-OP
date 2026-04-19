export type PaymentMethodType =
  | "debit_card"
  | "credit_card"
  | "pix"
  | "transfer"
  | "cash";

export type PaymentMethod = {
  id: string;
  type: PaymentMethodType;
  label: string;
  lastDigits?: string;
  cardNumber?: string;
  limit?: number;
  pixKey?: string;
};

export type Account = {
  id: string;
  name: string;
  agency?: string;
  accountNumber?: string;
  paymentMethods: PaymentMethod[];
  active: boolean;
  resultCenterId?: string;
};
