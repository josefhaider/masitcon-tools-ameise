import { NextResponse } from "next/server";
import { requireAdmin } from "../../_lib/admin-auth";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status! });
    }

    const adminClient = auth.adminClient!;
    const { email, password, full_name, employee_number } =
      await request.json();

    if (!email || !password || !full_name) {
      return NextResponse.json(
        { error: "E-Mail, Passwort und Name sind erforderlich" },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Passwort muss mindestens 6 Zeichen haben" },
        { status: 400 }
      );
    }

    console.log("Creating auth user for:", email);
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      });

    if (authError) {
      console.error("Auth user creation failed:", authError);
      if (authError.message.includes("already registered")) {
        return NextResponse.json(
          { error: "Diese E-Mail-Adresse wird bereits verwendet" },
          { status: 400 }
        );
      }
      throw authError;
    }

    console.log("Auth user created:", authData.user.id);

    let profileReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("id")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (profile) {
        profileReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!profileReady) {
      console.warn(
        "Profile not created by trigger after 5s for:",
        authData.user.id
      );
    }

    if (employee_number && profileReady) {
      console.log("Updating profile for:", authData.user.id);
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ employee_number })
        .eq("id", authData.user.id);
      if (profileError)
        console.error("Profile update failed:", profileError);
    }

    console.log("Employee created successfully:", authData.user.id);
    return NextResponse.json({
      success: true,
      user_id: authData.user.id,
      email: authData.user.email,
    });
  } catch (error) {
    console.error("Error in create-employee:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Ein Fehler ist aufgetreten";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
