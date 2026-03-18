import { NextResponse } from "next/server";
import { requireAdmin } from "../../_lib/admin-auth";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status! });
    }

    const user = auth.user!;
    const adminClient = auth.adminClient!;
    const { action, target_user_id, new_email, new_password, confirmation_code } =
      await request.json();

    if (!action || !target_user_id) {
      return NextResponse.json(
        { error: "Aktion und Benutzer-ID sind erforderlich" },
        { status: 400 }
      );
    }

    if (
      target_user_id === user.id &&
      (action === "update_email" || action === "reset_password")
    ) {
      return NextResponse.json(
        {
          error:
            "Eigene E-Mail oder Passwort bitte über Profileinstellungen ändern",
        },
        { status: 400 }
      );
    }

    let result: Record<string, unknown>;

    switch (action) {
      case "update_email": {
        if (!new_email || !new_email.includes("@")) {
          return NextResponse.json(
            { error: "Gültige E-Mail-Adresse erforderlich" },
            { status: 400 }
          );
        }
        const { data: emailData, error: emailError } =
          await adminClient.auth.admin.updateUserById(target_user_id, {
            email: new_email,
            email_confirm: true,
          });
        if (emailError) {
          console.error("Email update failed:", emailError);
          if (
            emailError.message.includes("already registered") ||
            emailError.message.includes("duplicate")
          ) {
            return NextResponse.json(
              { error: "Diese E-Mail-Adresse wird bereits verwendet" },
              { status: 400 }
            );
          }
          throw emailError;
        }
        await adminClient
          .from("profiles")
          .update({ email: new_email })
          .eq("id", target_user_id);
        result = {
          success: true,
          message: "E-Mail-Adresse aktualisiert",
          email: emailData.user.email,
        };
        break;
      }

      case "reset_password": {
        if (!new_password || new_password.length < 6) {
          return NextResponse.json(
            { error: "Passwort muss mindestens 6 Zeichen haben" },
            { status: 400 }
          );
        }
        const { error: passwordError } =
          await adminClient.auth.admin.updateUserById(target_user_id, {
            password: new_password,
          });
        if (passwordError) {
          console.error("Password reset failed:", passwordError);
          throw passwordError;
        }
        result = { success: true, message: "Passwort wurde zurückgesetzt" };
        break;
      }

      case "send_password_reset": {
        const { data: targetUser, error: targetUserError } =
          await adminClient.auth.admin.getUserById(target_user_id);
        if (targetUserError || !targetUser.user) {
          return NextResponse.json(
            { error: "Benutzer nicht gefunden" },
            { status: 404 }
          );
        }
        const { data: linkData, error: linkError } =
          await adminClient.auth.admin.generateLink({
            type: "recovery",
            email: targetUser.user.email!,
          });
        if (linkError) {
          console.error("Failed to generate reset link:", linkError);
          throw linkError;
        }
        result = {
          success: true,
          message: "Passwort-Reset-Link generiert",
          reset_link: linkData.properties.action_link,
        };
        break;
      }

      case "archive_user": {
        const { data: archiveUser, error: archiveUserError } =
          await adminClient.auth.admin.getUserById(target_user_id);
        if (archiveUserError || !archiveUser.user) {
          return NextResponse.json(
            { error: "Benutzer nicht gefunden" },
            { status: 404 }
          );
        }
        if (target_user_id === user.id) {
          return NextResponse.json(
            { error: "Sie können sich nicht selbst archivieren" },
            { status: 400 }
          );
        }
        const { error: banError } =
          await adminClient.auth.admin.updateUserById(target_user_id, {
            ban_duration: "87600h",
          });
        if (banError) {
          console.error("Failed to ban user:", banError);
          throw banError;
        }
        const { error: archiveProfileError } = await adminClient
          .from("profiles")
          .update({
            is_archived: true,
            archived_at: new Date().toISOString(),
            archived_by: user.id,
          })
          .eq("id", target_user_id);
        if (archiveProfileError) {
          console.error("Failed to update profile:", archiveProfileError);
          throw archiveProfileError;
        }
        await adminClient.from("audit_logs").insert({
          user_id: user.id,
          user_email: user.email,
          action: "UPDATE",
          table_name: "profiles",
          record_id: target_user_id,
          old_values: { is_archived: false },
          new_values: { is_archived: true },
          description: `Mitarbeiter "${archiveUser.user.email}" archiviert`,
        });
        result = { success: true, message: "Mitarbeiter wurde archiviert" };
        break;
      }

      case "unarchive_user": {
        const { data: unarchiveUser, error: unarchiveUserError } =
          await adminClient.auth.admin.getUserById(target_user_id);
        if (unarchiveUserError || !unarchiveUser.user) {
          return NextResponse.json(
            { error: "Benutzer nicht gefunden" },
            { status: 404 }
          );
        }
        const { error: unbanError } =
          await adminClient.auth.admin.updateUserById(target_user_id, {
            ban_duration: "none",
          });
        if (unbanError) {
          console.error("Failed to unban user:", unbanError);
          throw unbanError;
        }
        const { error: unarchiveProfileError } = await adminClient
          .from("profiles")
          .update({
            is_archived: false,
            archived_at: null,
            archived_by: null,
          })
          .eq("id", target_user_id);
        if (unarchiveProfileError) {
          console.error("Failed to update profile:", unarchiveProfileError);
          throw unarchiveProfileError;
        }
        await adminClient.from("audit_logs").insert({
          user_id: user.id,
          user_email: user.email,
          action: "UPDATE",
          table_name: "profiles",
          record_id: target_user_id,
          old_values: { is_archived: true },
          new_values: { is_archived: false },
          description: `Mitarbeiter "${unarchiveUser.user.email}" reaktiviert`,
        });
        result = { success: true, message: "Mitarbeiter wurde reaktiviert" };
        break;
      }

      case "delete_user": {
        const { data: deleteUser, error: deleteUserError } =
          await adminClient.auth.admin.getUserById(target_user_id);
        if (deleteUserError || !deleteUser.user) {
          return NextResponse.json(
            { error: "Benutzer nicht gefunden" },
            { status: 404 }
          );
        }
        if (target_user_id === user.id) {
          return NextResponse.json(
            { error: "Sie können sich nicht selbst löschen" },
            { status: 400 }
          );
        }
        const { data: profileData } = await adminClient
          .from("profiles")
          .select("full_name")
          .eq("id", target_user_id)
          .single();
        const employeeName =
          (profileData as Record<string, unknown>)?.full_name || "";
        const expectedCode = `LÖSCHEN-${employeeName}`;
        if (!confirmation_code || confirmation_code !== expectedCode) {
          return NextResponse.json(
            {
              error: "Bestätigungscode stimmt nicht überein",
              expected_format: "LÖSCHEN-[Mitarbeitername]",
            },
            { status: 400 }
          );
        }
        await adminClient.from("audit_logs").insert({
          user_id: user.id,
          user_email: user.email,
          action: "DELETE",
          table_name: "profiles",
          record_id: target_user_id,
          old_values: {
            full_name: employeeName,
            email: deleteUser.user.email,
          },
          new_values: null,
          description: `Mitarbeiter "${employeeName}" (${deleteUser.user.email}) und alle zugehörigen Daten unwiderruflich gelöscht`,
        });
        await adminClient
          .from("time_entries")
          .delete()
          .eq("user_id", target_user_id);
        await adminClient
          .from("absences")
          .delete()
          .eq("user_id", target_user_id);
        await adminClient
          .from("balance_corrections")
          .delete()
          .eq("user_id", target_user_id);
        await adminClient
          .from("employee_work_schedules")
          .delete()
          .eq("user_id", target_user_id);
        await adminClient
          .from("team_members")
          .delete()
          .eq("user_id", target_user_id);
        await adminClient
          .from("user_roles")
          .delete()
          .eq("user_id", target_user_id);
        await adminClient
          .from("profiles")
          .delete()
          .eq("id", target_user_id);
        const { error: deleteAuthError } =
          await adminClient.auth.admin.deleteUser(target_user_id);
        if (deleteAuthError) {
          console.error("Failed to delete auth user:", deleteAuthError);
          throw deleteAuthError;
        }
        result = {
          success: true,
          message: `Mitarbeiter "${employeeName}" und alle zugehörigen Daten wurden unwiderruflich gelöscht`,
        };
        break;
      }

      default:
        return NextResponse.json(
          { error: "Unbekannte Aktion" },
          { status: 400 }
        );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error in admin-update-user:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Ein Fehler ist aufgetreten";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
