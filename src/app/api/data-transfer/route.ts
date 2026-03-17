import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Helper: Email-Lookup Map ─────────────────────────────────────────────
async function buildEmailMap(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", uniqueIds);
  const map = new Map<string, string>();
  for (const p of profiles || []) map.set(p.id, p.email);
  return map;
}

async function buildTemplateNameMap(
  supabase: SupabaseClient,
  templateIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(templateIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const { data: templates } = await supabase
    .from("time_templates")
    .select("id, name")
    .in("id", uniqueIds);
  const map = new Map<string, string>();
  for (const t of templates || []) map.set(t.id, t.name);
  return map;
}

async function buildTeamNameMap(
  supabase: SupabaseClient,
  teamIds: string[]
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(teamIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .in("id", uniqueIds);
  const map = new Map<string, string>();
  for (const t of teams || []) map.set(t.id, t.name);
  return map;
}

// ─── Export Handler ───────────────────────────────────────────────────────
async function handleExport(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  user: { id: string; email: string },
  supabaseUrl: string
) {
  const { employee_emails } = body as { employee_emails?: string[] };
  if (
    !employee_emails ||
    !Array.isArray(employee_emails) ||
    employee_emails.length === 0
  ) {
    return NextResponse.json(
      { error: "employee_emails array is required" },
      { status: 400 }
    );
  }

  const employees: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  for (const email of employee_emails) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (!profile) {
      warnings.push(`Employee not found: ${email}`);
      continue;
    }
    const userId = profile.id;

    const [timeRes, absRes, schedRes, corrRes, teamRes, rolesRes] =
      await Promise.all([
        supabase
          .from("time_entries")
          .select("*")
          .eq("user_id", userId)
          .order("date"),
        supabase
          .from("absences")
          .select("*")
          .eq("user_id", userId)
          .order("start_date"),
        supabase
          .from("employee_work_schedules")
          .select("*")
          .eq("user_id", userId)
          .order("day_of_week"),
        supabase
          .from("balance_corrections")
          .select("*")
          .eq("user_id", userId)
          .order("effective_date"),
        supabase
          .from("team_members")
          .select("*")
          .eq("user_id", userId),
        supabase
          .from("user_roles")
          .select("*")
          .eq("user_id", userId),
      ]);

    const userIdsToResolve: string[] = [];
    for (const a of absRes.data || []) {
      if (a.approved_by) userIdsToResolve.push(a.approved_by);
      if (a.created_by) userIdsToResolve.push(a.created_by);
    }
    for (const c of corrRes.data || []) {
      if (c.created_by) userIdsToResolve.push(c.created_by);
    }

    const emailMap = await buildEmailMap(supabase, userIdsToResolve);
    const templateIds = (timeRes.data || [])
      .map((t: Record<string, unknown>) => t.template_id as string)
      .filter(Boolean);
    const templateMap = await buildTemplateNameMap(supabase, templateIds);
    const teamIds = (teamRes.data || [])
      .map((t: Record<string, unknown>) => t.team_id as string)
      .filter(Boolean);
    const teamMap = await buildTeamNameMap(supabase, teamIds);

    employees.push({
      email: profile.email,
      profile: {
        full_name: profile.full_name,
        employee_number: profile.employee_number,
        annual_vacation_days: profile.annual_vacation_days,
        default_weekly_hours: profile.default_weekly_hours,
        time_tracking_exempt: profile.time_tracking_exempt,
        is_archived: profile.is_archived,
      },
      roles: (rolesRes.data || []).map(
        (r: Record<string, unknown>) => r.role
      ),
      time_entries: (timeRes.data || []).map(
        (t: Record<string, unknown>) => ({
          date: t.date,
          start_time: t.start_time,
          end_time: t.end_time,
          break_minutes: t.break_minutes,
          notes: t.notes,
          template_name: t.template_id
            ? templateMap.get(t.template_id as string) || null
            : null,
        })
      ),
      absences: (absRes.data || []).map(
        (a: Record<string, unknown>) => ({
          type: a.type,
          start_date: a.start_date,
          end_date: a.end_date,
          status: a.status,
          is_half_day: a.is_half_day,
          notes: a.notes,
          approved_by_email: a.approved_by
            ? emailMap.get(a.approved_by as string) || null
            : null,
          created_by_email: a.created_by
            ? emailMap.get(a.created_by as string) || null
            : null,
          approved_at: a.approved_at,
          medical_certificate_status: a.medical_certificate_status,
          rejection_reason: a.rejection_reason,
        })
      ),
      work_schedules: (schedRes.data || []).map(
        (s: Record<string, unknown>) => ({
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          break_minutes: s.break_minutes,
          valid_from: s.valid_from,
          valid_to: s.valid_to,
          is_active: s.is_active,
        })
      ),
      balance_corrections: (corrRes.data || []).map(
        (c: Record<string, unknown>) => ({
          correction_type: c.correction_type,
          effective_date: c.effective_date,
          hours_adjustment: c.hours_adjustment,
          vacation_days_adjustment: c.vacation_days_adjustment,
          reason: c.reason,
          applies_to_year: c.applies_to_year,
          created_by_email: c.created_by
            ? emailMap.get(c.created_by as string) || null
            : null,
        })
      ),
      team_memberships: (teamRes.data || [])
        .map((t: Record<string, unknown>) => ({
          team_name: teamMap.get(t.team_id as string) || null,
          is_active: t.is_active,
        }))
        .filter(
          (t: { team_name: string | null }) => t.team_name !== null
        ),
    });
  }

  const exportData = {
    version: "1.0",
    exported_at: new Date().toISOString(),
    exported_by: user.email,
    source_url: supabaseUrl,
    employees,
  };

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email,
    action: "EXPORT",
    table_name: "data_transfer",
    description: `Data export for ${employees.length} employee(s): ${employee_emails.join(", ")}`,
    new_values: {
      employee_count: employees.length,
      emails: employee_emails,
    },
  });

  return NextResponse.json({ data: exportData, warnings });
}

// ─── Import Handler ───────────────────────────────────────────────────────
async function handleImport(
  supabase: SupabaseClient,
  body: Record<string, unknown>,
  user: { id: string; email: string }
) {
  const { data: importData } = body as {
    data?: {
      employees?: Record<string, unknown>[];
    };
  };
  if (
    !importData ||
    !importData.employees ||
    !Array.isArray(importData.employees)
  ) {
    return NextResponse.json(
      { error: "Invalid import data structure" },
      { status: 400 }
    );
  }

  const { data: allProfiles } = await supabase
    .from("profiles")
    .select("id, email");
  const profileEmailMap = new Map<string, string>();
  for (const p of allProfiles || []) profileEmailMap.set(p.email, p.id);

  const { data: allTeams } = await supabase
    .from("teams")
    .select("id, name");
  const teamNameMap = new Map<string, string>();
  for (const t of allTeams || []) teamNameMap.set(t.name, t.id);

  const { data: allTemplates } = await supabase
    .from("time_templates")
    .select("id, name");
  const templateNameMap = new Map<string, string>();
  for (const t of allTemplates || []) templateNameMap.set(t.name, t.id);

  const results: Record<string, unknown>[] = [];

  for (const emp of importData.employees as Record<string, unknown>[]) {
    const userId = profileEmailMap.get(emp.email as string);
    if (!userId) {
      results.push({
        email: emp.email,
        status: "skipped",
        reason: "Employee not found in target environment",
      });
      continue;
    }

    try {
      await supabase.from("time_entries").delete().eq("user_id", userId);
      await supabase.from("absences").delete().eq("user_id", userId);
      await supabase
        .from("balance_corrections")
        .delete()
        .eq("user_id", userId);
      await supabase
        .from("employee_work_schedules")
        .delete()
        .eq("user_id", userId);
      await supabase.from("team_members").delete().eq("user_id", userId);
      await supabase.from("user_roles").delete().eq("user_id", userId);

      const timeEntries = emp.time_entries as Record<string, unknown>[] | undefined;
      if (timeEntries && timeEntries.length > 0) {
        const timeRows = timeEntries.map((t) => ({
          user_id: userId,
          date: t.date,
          start_time: t.start_time,
          end_time: t.end_time,
          break_minutes: (t.break_minutes as number) ?? 0,
          notes: (t.notes as string) || null,
          template_id: t.template_name
            ? templateNameMap.get(t.template_name as string) || null
            : null,
        }));
        for (let i = 0; i < timeRows.length; i += 500) {
          const { error } = await supabase
            .from("time_entries")
            .insert(timeRows.slice(i, i + 500));
          if (error)
            throw new Error(`time_entries insert error: ${error.message}`);
        }
      }

      const absences = emp.absences as Record<string, unknown>[] | undefined;
      if (absences && absences.length > 0) {
        const absRows = absences.map((a) => ({
          user_id: userId,
          type: a.type,
          start_date: a.start_date,
          end_date: a.end_date,
          status: (a.status as string) || "pending",
          is_half_day: (a.is_half_day as boolean) ?? false,
          notes: (a.notes as string) || null,
          approved_by: a.approved_by_email
            ? profileEmailMap.get(a.approved_by_email as string) || null
            : null,
          created_by: a.created_by_email
            ? profileEmailMap.get(a.created_by_email as string) || null
            : null,
          approved_at: (a.approved_at as string) || null,
          medical_certificate_status:
            (a.medical_certificate_status as string) || null,
          rejection_reason: (a.rejection_reason as string) || null,
        }));
        const { error } = await supabase.from("absences").insert(absRows);
        if (error)
          throw new Error(`absences insert error: ${error.message}`);
      }

      const workSchedules = emp.work_schedules as Record<string, unknown>[] | undefined;
      if (workSchedules && workSchedules.length > 0) {
        const schedRows = workSchedules.map((s) => ({
          user_id: userId,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          break_minutes: (s.break_minutes as number) ?? 0,
          valid_from: s.valid_from,
          valid_to: (s.valid_to as string) || null,
          is_active: (s.is_active as boolean) ?? true,
        }));
        const { error } = await supabase
          .from("employee_work_schedules")
          .insert(schedRows);
        if (error)
          throw new Error(`work_schedules insert error: ${error.message}`);
      }

      const balanceCorrections = emp.balance_corrections as Record<string, unknown>[] | undefined;
      if (balanceCorrections && balanceCorrections.length > 0) {
        const corrRows = balanceCorrections.map((c) => ({
          user_id: userId,
          correction_type: c.correction_type,
          effective_date: c.effective_date,
          hours_adjustment: (c.hours_adjustment as number) ?? null,
          vacation_days_adjustment:
            (c.vacation_days_adjustment as number) ?? null,
          reason: c.reason,
          applies_to_year: (c.applies_to_year as number) ?? null,
          created_by: c.created_by_email
            ? profileEmailMap.get(c.created_by_email as string) || userId
            : userId,
        }));
        const { error } = await supabase
          .from("balance_corrections")
          .insert(corrRows);
        if (error)
          throw new Error(
            `balance_corrections insert error: ${error.message}`
          );
      }

      const teamMemberships = emp.team_memberships as Record<string, unknown>[] | undefined;
      if (teamMemberships && teamMemberships.length > 0) {
        const teamRows = teamMemberships
          .filter(
            (t) =>
              t.team_name && teamNameMap.has(t.team_name as string)
          )
          .map((t) => ({
            user_id: userId,
            team_id: teamNameMap.get(t.team_name as string)!,
            is_active: (t.is_active as boolean) ?? true,
          }));
        if (teamRows.length > 0) {
          const { error } = await supabase
            .from("team_members")
            .insert(teamRows);
          if (error)
            throw new Error(
              `team_members insert error: ${error.message}`
            );
        }
        const skippedTeams = teamMemberships
          .filter(
            (t) =>
              t.team_name &&
              !teamNameMap.has(t.team_name as string)
          )
          .map((t) => t.team_name);
        if (skippedTeams.length > 0) {
          results.push({
            email: emp.email,
            status: "warning",
            reason: `Teams not found: ${skippedTeams.join(", ")}`,
          });
        }
      }

      const roles = emp.roles as string[] | undefined;
      if (roles && roles.length > 0) {
        const roleRows = roles.map((r) => ({
          user_id: userId,
          role: r,
        }));
        const { error } = await supabase
          .from("user_roles")
          .insert(roleRows);
        if (error)
          throw new Error(`user_roles insert error: ${error.message}`);
      }

      const empProfile = emp.profile as Record<string, unknown> | undefined;
      if (empProfile) {
        const { error } = await supabase
          .from("profiles")
          .update({
            full_name: empProfile.full_name,
            employee_number:
              (empProfile.employee_number as string) ?? null,
            annual_vacation_days:
              (empProfile.annual_vacation_days as number) ?? null,
            default_weekly_hours:
              (empProfile.default_weekly_hours as number) ?? null,
            time_tracking_exempt:
              (empProfile.time_tracking_exempt as boolean) ?? false,
            is_archived:
              (empProfile.is_archived as boolean) ?? false,
          })
          .eq("id", userId);
        if (error)
          throw new Error(`profile update error: ${error.message}`);
      }

      results.push({
        email: emp.email,
        status: "imported",
        counts: {
          time_entries: timeEntries?.length ?? 0,
          absences: absences?.length ?? 0,
          work_schedules: workSchedules?.length ?? 0,
          balance_corrections: balanceCorrections?.length ?? 0,
          team_memberships: teamMemberships?.length ?? 0,
          roles: roles?.length ?? 0,
        },
      });
    } catch (err: unknown) {
      results.push({
        email: emp.email,
        status: "error",
        reason:
          err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email,
    action: "IMPORT",
    table_name: "data_transfer",
    description: `Data import for ${importData.employees.length} employee(s)`,
    new_values: { results },
  });

  return NextResponse.json({ results });
}

// ─── POST Handler ─────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const transferPassword = process.env.DATA_TRANSFER_PASSWORD;

    if (!transferPassword) {
      return NextResponse.json(
        { error: "DATA_TRANSFER_PASSWORD is not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { action, password, user_email } = body as {
      action?: string;
      password?: string;
      user_email?: string;
    };

    if (!user_email) {
      return NextResponse.json(
        { error: "Missing user_email in request body" },
        { status: 400 }
      );
    }
    if (password !== transferPassword) {
      return NextResponse.json(
        { error: "Invalid transfer password" },
        { status: 403 }
      );
    }

    const { data: userProfile } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", user_email)
      .maybeSingle();

    if (!userProfile) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", (userProfile as Record<string, unknown>).id as string)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return NextResponse.json(
        { error: "Unauthorized: Admin role required" },
        { status: 403 }
      );
    }

    const user = {
      id: (userProfile as Record<string, unknown>).id as string,
      email: (userProfile as Record<string, unknown>).email as string,
    };

    if (action === "export") {
      return await handleExport(supabase, body, user, supabaseUrl);
    } else if (action === "import") {
      return await handleImport(supabase, body, user);
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'export' or 'import'" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Data transfer error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Internal server error",
      },
      { status: 500 }
    );
  }
}
