import { NextRequest, NextResponse } from "next/server";

import { assertHrAccess } from "@/features/hr/lib/server-access";
import { hrDbAdmin } from "@/lib/firebase-rh-admin";
import { authAdmin, dbAdmin } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    await assertHrAccess(request, "manage");
    const { roleId } = await params;

    const roleSnap = await hrDbAdmin.collection("jobRoles").doc(roleId).get();
    if (!roleSnap.exists) {
      return NextResponse.json({ error: "Cargo não encontrado." }, { status: 404 });
    }

    const roleData = roleSnap.data() ?? {};
    const defaultProfileId =
      typeof roleData.defaultProfileId === "string" && roleData.defaultProfileId
        ? roleData.defaultProfileId
        : null;

    if (!defaultProfileId) {
      return NextResponse.json(
        { error: "Este cargo não possui perfil padrão configurado." },
        { status: 400 }
      );
    }

    const profileSnap = await dbAdmin.collection("profiles").doc(defaultProfileId).get();
    if (!profileSnap.exists) {
      return NextResponse.json(
        { error: "O perfil padrão configurado para este cargo não foi encontrado." },
        { status: 404 }
      );
    }

    const isDefaultAdmin = profileSnap.data()?.isDefaultAdmin === true;
    const usersSnap = await dbAdmin
      .collection("users")
      .where("jobRoleId", "==", roleId)
      .get();

    const activeUsers = usersSnap.docs.filter(
      (doc) => (doc.data()?.isActive as boolean | undefined) !== false
    );

    const changedUsers: Array<{ id: string; username: string; previousProfileId?: string }> = [];
    const skippedUsers: Array<{ id: string; username: string; reason: string }> = [];

    for (const userDoc of activeUsers) {
      const userData = userDoc.data() ?? {};
      const username =
        typeof userData.username === "string" && userData.username
          ? userData.username
          : userDoc.id;
      const currentProfileId =
        typeof userData.profileId === "string" ? userData.profileId : undefined;

      if (currentProfileId === defaultProfileId) {
        skippedUsers.push({
          id: userDoc.id,
          username,
          reason: "already_synced",
        });
        continue;
      }

      await userDoc.ref.update({ profileId: defaultProfileId });
      await authAdmin.setCustomUserClaims(userDoc.id, {
        profileId: defaultProfileId,
        isDefaultAdmin,
      });

      changedUsers.push({
        id: userDoc.id,
        username,
        previousProfileId: currentProfileId,
      });
    }

    return NextResponse.json({
      roleId,
      targetProfileId: defaultProfileId,
      targetProfileName: profileSnap.data()?.name ?? null,
      matchedActiveUsers: activeUsers.length,
      updatedUsers: changedUsers,
      skippedUsers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro ao sincronizar perfil padrão do cargo.",
      },
      { status: 400 }
    );
  }
}
