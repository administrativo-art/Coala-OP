"use client";

import { type User as FirebaseUser } from "firebase/auth";
import { Timestamp } from "firebase/firestore";

import {
  type BaseProduct,
  type EmployeeGoal,
  type GoalPeriodDoc,
  type GoalTemplate,
  type Kiosk,
  type LotEntry,
  type Product,
  type Profile,
  type User,
} from "@/types";

export type ClientBootstrapCollection =
  | "currentUser"
  | "profiles"
  | "users"
  | "kiosks"
  | "products"
  | "baseProducts"
  | "lots"
  | "goals";

export type ClientBootstrapPayload = {
  currentUser?: User;
  profiles?: Profile[];
  users?: User[];
  kiosks?: Kiosk[];
  products?: Product[];
  baseProducts?: BaseProduct[];
  lots?: LotEntry[];
  goalTemplates?: GoalTemplate[];
  goalPeriods?: GoalPeriodDoc[];
  employeeGoals?: EmployeeGoal[];
};

function reviveFirestoreValues(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;

  const marker = value as {
    __type?: unknown;
    seconds?: unknown;
    nanoseconds?: unknown;
  };

  if (
    marker.__type === "firestore-timestamp" &&
    typeof marker.seconds === "number" &&
    typeof marker.nanoseconds === "number"
  ) {
    return new Timestamp(marker.seconds, marker.nanoseconds);
  }

  if (Array.isArray(value)) return value.map(reviveFirestoreValues);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      reviveFirestoreValues(entry),
    ])
  );
}

export async function fetchClientBootstrap(
  firebaseUser: FirebaseUser,
  collections: ClientBootstrapCollection[]
): Promise<ClientBootstrapPayload> {
  const token = await firebaseUser.getIdToken();
  const params = new URLSearchParams({
    collections: Array.from(new Set(collections)).join(","),
  });
  const response = await fetch(`/api/client/bootstrap?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `HTTP ${response.status}`);
  }

  return reviveFirestoreValues(await response.json()) as ClientBootstrapPayload;
}
