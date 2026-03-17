import { createClient } from "@/lib/supabase/server";

export type SessionWithRoles = {
  user: { id: string; email: string };
  profile: {
    id: string;
    full_name: string | null;
    employee_number: string | null;
    email: string | null;
    is_archived: boolean | null;
  } | null;
  roles: string[];
  isAdmin: boolean;
  isApprover: boolean;
  isHrManager: boolean;
};

export async function getSessionWithRoles(): Promise<SessionWithRoles | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, employee_number, email, is_archived")
    .eq("id", user.id)
    .single();

  const { data: rolesData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  const roles = rolesData?.map((r) => r.role) ?? [];

  return {
    user: { id: user.id, email: user.email ?? "" },
    profile: profile ?? null,
    roles,
    isAdmin: roles.includes("admin"),
    isApprover:
      roles.includes("vacation_approver") || roles.includes("admin"),
    isHrManager: roles.includes("hr_manager") || roles.includes("admin"),
  };
}
