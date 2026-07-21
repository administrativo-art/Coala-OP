import type { z } from "zod";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { maskBrazilianDocument } from "@/features/financial/beneficiaries/normalization";
import { asoClinicConfigInputSchema } from "@/features/financial/beneficiaries/schemas";
import type { AsoClinicConfig } from "@/features/financial/beneficiaries/types";

const COLLECTION = "asoClinicConfigs";
type ClinicInput = z.infer<typeof asoClinicConfigInputSchema>;
type Actor = { uid: string; name?: string | null; email?: string | null };

export async function listAsoClinicConfigs() {
  const [entities, configs, paymentProfiles] = await Promise.all([
    dbAdmin.collection("entities").get(),
    hrDbAdmin.collection(COLLECTION).get(),
    financialDbAdmin.collection("supplierPaymentProfiles").get(),
  ]);
  const entitiesById = new Map(entities.docs.map((item) => [item.id, item.data()]));
  const paymentById = new Map(paymentProfiles.docs.map((item) => [item.id, item.data()]));
  return configs.docs
    .map((document) => {
      const config = document.data();
      const entity = entitiesById.get(document.id);
      const payment = paymentById.get(document.id);
      return {
        id: document.id,
        ...config,
        entity: entity
          ? {
              id: document.id,
              name: entity.name ?? entity.razao_social ?? "Clínica",
              documentMasked: maskBrazilianDocument(entity.document ?? entity.cnpj),
              status: entity.status ?? "active",
            }
          : null,
        paymentProfile: {
          configured: Boolean(payment?.encryptedPaymentData),
          active: payment?.active !== false,
          validated: Boolean(payment?.validatedAt),
          maskedPaymentDestination: payment?.maskedPaymentDestination ?? null,
        },
      };
    })
    .sort((left, right) =>
      String(left.entity?.name ?? "").localeCompare(String(right.entity?.name ?? ""), "pt-BR"),
    );
}
export async function listEligibleClinicEntities() {
  const entities = await dbAdmin.collection("entities").get();
  return entities.docs
    .filter((document) => document.get("status") !== "inactive")
    .map((document) => ({
      id: document.id,
      name: String(document.get("name") ?? document.get("razao_social") ?? "Pessoa/empresa"),
      documentMasked: maskBrazilianDocument(document.get("document") ?? document.get("cnpj")),
      type: document.get("type") ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

export async function saveAsoClinicConfig(input: ClinicInput, actor: Actor) {
  const entityRef = dbAdmin.collection("entities").doc(input.entityId);
  const configRef = hrDbAdmin.collection(COLLECTION).doc(input.entityId);
  const [entity, current] = await Promise.all([entityRef.get(), configRef.get()]);
  if (!entity.exists) throw new Error("Pessoa ou empresa da clínica não encontrada.");
  if (entity.get("status") === "inactive") throw new Error("Não é possível configurar uma clínica inativa.");

  const now = new Date().toISOString();
  const config: AsoClinicConfig = {
    entityId: input.entityId,
    active: input.active,
    asoPrice: input.asoPrice,
    defaultPaymentDescription: input.defaultPaymentDescription,
    schedulingEmail: input.schedulingEmail.toLowerCase(),
    address: {
      ...input.address,
      ...(input.address.complement ? { complement: input.address.complement } : {}),
      ...(input.address.reference ? { reference: input.address.reference } : {}),
      ...(input.address.mapsUrl ? { mapsUrl: input.address.mapsUrl } : {}),
    },
    createdAt: current.get("createdAt") ?? now,
    createdBy: current.get("createdBy") ?? actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  };
  await configRef.set(config, { merge: false });
  await configRef.collection("events").add({
    type: current.exists ? "aso_clinic_updated" : "aso_clinic_created",
    at: now,
    actorId: actor.uid,
    actorName: actor.name ?? null,
    actorEmail: actor.email ?? null,
    before: current.exists
      ? {
          active: current.get("active") !== false,
          asoPrice: current.get("asoPrice") ?? null,
          schedulingEmail: current.get("schedulingEmail") ?? null,
        }
      : null,
    after: {
      active: config.active,
      asoPrice: config.asoPrice,
      schedulingEmail: config.schedulingEmail,
    },
  });
  return { id: input.entityId, ...config };
}
