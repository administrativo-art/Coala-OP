export type PaymentBeneficiarySourceType = "employee" | "entity";

export type PaymentBeneficiaryReference =
  | { sourceType: "employee"; sourceId: string }
  | { sourceType: "entity"; sourceId: string };

export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";
export type PaymentMethod = "pix_key" | "pix_copy_paste" | "bank_details";

export type BankDetails = {
  bankCode: string;
  agency: string;
  account: string;
  accountType: "checking" | "savings" | "payment";
};
export type ProtectedPaymentDestination = {
  pixKey?: string;
  pixCopyPaste?: string;
  bankDetails?: BankDetails;
};

export type SupplierPaymentProfile = {
  entityId: string;
  active: boolean;
  paymentMethod: PaymentMethod;
  pixKeyType?: PixKeyType;
  encryptedPaymentData: string;
  maskedPaymentDestination: string;
  holderName: string;
  holderDocument: string;
  validatedAt?: string | null;
  validatedBy?: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type BeneficiaryListItem = {
  reference: PaymentBeneficiaryReference;
  name: string;
  documentMasked: string;
  active: boolean;
  paymentMethod?: PaymentMethod;
  pixKeyType?: PixKeyType;
  maskedPaymentDestination?: string;
  configured: boolean;
  validated: boolean;
  sourceUpdatedAt?: string | null;
};

export type ResolvedPaymentBeneficiary = {
  sourceType: PaymentBeneficiarySourceType;
  sourceId: string;
  name: string;
  document: string;
  paymentMethod: PaymentMethod;
  pixKeyType?: PixKeyType;
  pixKey?: string;
  pixCopyPaste?: string;
  bankDetails?: BankDetails;
  validated: boolean;
  sourceUpdatedAt: string;
};

export type BeneficiarySnapshot = {
  sourceType: PaymentBeneficiarySourceType;
  sourceId: string;
  name: string;
  document: string;
  paymentMethod: PaymentMethod;
  pixKeyType?: PixKeyType;
  maskedPaymentDestination: string;
  sourceUpdatedAt: string;
  resolvedAt: string;
};

export type AsoClinicConfig = {
  entityId: string;
  active: boolean;
  asoPrice: number;
  defaultPaymentDescription: string;
  schedulingEmail: string;
  address: {
    street: string;
    number: string;
    complement?: string;
    district: string;
    city: string;
    state: string;
    postalCode: string;
    reference?: string;
    mapsUrl?: string;
  };
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};
