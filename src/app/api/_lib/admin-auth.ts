import { createClient } from "@supabase/supabase-js";
import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function createAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Prüft ob der aktuelle Benutzer eingeloggt und Admin ist.
 * Gibt { user, adminClient } zurück oder { error, status }.
 */
export async function requireAdmin(): Promise<
  | { user: { id: string; email: string }; adminClient: ReturnType<typeof createAdminClient>; error?: never; status?: never }
  | { error: string; status: number; user?: never; adminClient?: never }
> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: "Unauthorized", status: 401 };
  }

  const adminClient = createAdminClient();

  const { data: roles, error: rolesError } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  if (
    rolesError ||
    !roles ||
    !roles.some((r: { role: string }) => r.role === "admin")
  ) {
    return {
      error: "Nur Administratoren können diese Aktion ausführen",
      status: 403,
    };
  }

  return {
    user: { id: user.id, email: user.email! },
    adminClient,
  };
}
