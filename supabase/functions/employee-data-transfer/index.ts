import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const transferPassword = Deno.env.get("DATA_TRANSFER_PASSWORD");

    if (!transferPassword) {
      return new Response(
        JSON.stringify({ error: "DATA_TRANSFER_PASSWORD is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role client for all data operations
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { action, password, user_email } = body;

    // Validate that user_email is provided
    if (!user_email) {
      return new Response(
        JSON.stringify({ error: "Missing user_email in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate password
    if (password !== transferPassword) {
      return new Response(
        JSON.stringify({ error: "Invalid transfer password" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up user by email in profiles
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", user_email)
      .maybeSingle();

    if (!userProfile) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check admin role using the resolved user ID
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userProfile.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const user = { id: userProfile.id, email: userProfile.email };

    if (action === "export") {
      return await handleExport(supabase, body, user, supabaseUrl);
    } else if (action === "import") {
      return await handleImport(supabase, body, user);
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid action. Use 'export' or 'import'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Data transfer error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── HELPER: Build email lookup map from user IDs ───
async function buildEmailMap(supabase: any, userIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", uniqueIds);

  const map = new Map<string, string>();
  for (const p of profiles || []) {
    map.set(p.id, p.email);
  }
  return map;
}

// ─── HELPER: Build template name map from IDs ───
async function buildTemplateNameMap(supabase: any, templateIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(templateIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data: templates } = await supabase
    .from("time_templates")
    .select("id, name")
    .in("id", uniqueIds);

  const map = new Map<string, string>();
  for (const t of templates || []) {
    map.set(t.id, t.name);
  }
  return map;
}

// ─── HELPER: Build team name map from IDs ───
async function buildTeamNameMap(supabase: any, teamIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(teamIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .in("id", uniqueIds);

  const map = new Map<string, string>();
  for (const t of teams || []) {
    map.set(t.id, t.name);
  }
  return map;
}

// ─── EXPORT ───
async function handleExport(supabase: any, body: any, user: any, supabaseUrl: string) {
  const { employee_emails } = body;

  if (!employee_emails || !Array.isArray(employee_emails) || employee_emails.length === 0) {
    return new Response(
      JSON.stringify({ error: "employee_emails array is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const employees: any[] = [];
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

    // Load all data in parallel
    const [timeRes, absRes, schedRes, corrRes, teamRes, rolesRes] = await Promise.all([
      supabase.from("time_entries").select("*").eq("user_id", userId).order("date"),
      supabase.from("absences").select("*").eq("user_id", userId).order("start_date"),
      supabase.from("employee_work_schedules").select("*").eq("user_id", userId).order("day_of_week"),
      supabase.from("balance_corrections").select("*").eq("user_id", userId).order("effective_date"),
      supabase.from("team_members").select("*").eq("user_id", userId),
      supabase.from("user_roles").select("*").eq("user_id", userId),
    ]);

    // Collect all user IDs that need email resolution
    const userIdsToResolve: string[] = [];
    for (const a of absRes.data || []) {
      if (a.approved_by) userIdsToResolve.push(a.approved_by);
      if (a.created_by) userIdsToResolve.push(a.created_by);
    }
    for (const c of corrRes.data || []) {
      if (c.created_by) userIdsToResolve.push(c.created_by);
    }

    const emailMap = await buildEmailMap(supabase, userIdsToResolve);

    // Resolve template IDs
    const templateIds = (timeRes.data || []).map((t: any) => t.template_id).filter(Boolean);
    const templateMap = await buildTemplateNameMap(supabase, templateIds);

    // Resolve team IDs
    const teamIds = (teamRes.data || []).map((t: any) => t.team_id).filter(Boolean);
    const teamMap = await buildTeamNameMap(supabase, teamIds);

    const employeeData = {
      email: profile.email,
      profile: {
        full_name: profile.full_name,
        employee_number: profile.employee_number,
        annual_vacation_days: profile.annual_vacation_days,
        default_weekly_hours: profile.default_weekly_hours,
        time_tracking_exempt: profile.time_tracking_exempt,
        is_archived: profile.is_archived,
      },
      roles: (rolesRes.data || []).map((r: any) => r.role),
      time_entries: (timeRes.data || []).map((t: any) => ({
        date: t.date,
        start_time: t.start_time,
        end_time: t.end_time,
        break_minutes: t.break_minutes,
        notes: t.notes,
        template_name: t.template_id ? templateMap.get(t.template_id) || null : null,
      })),
      absences: (absRes.data || []).map((a: any) => ({
        type: a.type,
        start_date: a.start_date,
        end_date: a.end_date,
        status: a.status,
        is_half_day: a.is_half_day,
        notes: a.notes,
        approved_by_email: a.approved_by ? emailMap.get(a.approved_by) || null : null,
        created_by_email: a.created_by ? emailMap.get(a.created_by) || null : null,
        approved_at: a.approved_at,
        medical_certificate_status: a.medical_certificate_status,
        rejection_reason: a.rejection_reason,
      })),
      work_schedules: (schedRes.data || []).map((s: any) => ({
        day_of_week: s.day_of_week,
        start_time: s.start_time,
        end_time: s.end_time,
        break_minutes: s.break_minutes,
        valid_from: s.valid_from,
        valid_to: s.valid_to,
        is_active: s.is_active,
      })),
      balance_corrections: (corrRes.data || []).map((c: any) => ({
        correction_type: c.correction_type,
        effective_date: c.effective_date,
        hours_adjustment: c.hours_adjustment,
        vacation_days_adjustment: c.vacation_days_adjustment,
        reason: c.reason,
        applies_to_year: c.applies_to_year,
        created_by_email: c.created_by ? emailMap.get(c.created_by) || null : null,
      })),
      team_memberships: (teamRes.data || []).map((t: any) => ({
        team_name: teamMap.get(t.team_id) || null,
        is_active: t.is_active,
      })).filter((t: any) => t.team_name !== null),
    };

    employees.push(employeeData);
  }

  const exportData = {
    version: "1.0",
    exported_at: new Date().toISOString(),
    exported_by: user.email,
    source_url: supabaseUrl,
    employees,
  };

  // Audit log
  await supabase.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email,
    action: "EXPORT",
    table_name: "data_transfer",
    description: `Data export for ${employees.length} employee(s): ${employee_emails.join(", ")}`,
    new_values: { employee_count: employees.length, emails: employee_emails },
  });

  return new Response(
    JSON.stringify({ data: exportData, warnings }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ─── IMPORT ───
async function handleImport(supabase: any, body: any, user: any) {
  const { data: importData } = body;

  if (!importData || !importData.employees || !Array.isArray(importData.employees)) {
    return new Response(
      JSON.stringify({ error: "Invalid import data structure" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Pre-load all profiles for email resolution
  const { data: allProfiles } = await supabase
    .from("profiles")
    .select("id, email");
  const profileEmailMap = new Map<string, string>();
  for (const p of allProfiles || []) {
    profileEmailMap.set(p.email, p.id);
  }

  // Pre-load all teams for name resolution
  const { data: allTeams } = await supabase
    .from("teams")
    .select("id, name");
  const teamNameMap = new Map<string, string>();
  for (const t of allTeams || []) {
    teamNameMap.set(t.name, t.id);
  }

  // Pre-load all templates for name resolution
  const { data: allTemplates } = await supabase
    .from("time_templates")
    .select("id, name");
  const templateNameMap = new Map<string, string>();
  for (const t of allTemplates || []) {
    templateNameMap.set(t.name, t.id);
  }

  const results: any[] = [];

  for (const emp of importData.employees) {
    const userId = profileEmailMap.get(emp.email);

    if (!userId) {
      results.push({
        email: emp.email,
        status: "skipped",
        reason: "Employee not found in target environment",
      });
      continue;
    }

    try {
      // ── 1. DELETE existing data (correct order for FK constraints) ──
      await supabase.from("time_entries").delete().eq("user_id", userId);
      await supabase.from("absences").delete().eq("user_id", userId);
      await supabase.from("balance_corrections").delete().eq("user_id", userId);
      await supabase.from("employee_work_schedules").delete().eq("user_id", userId);
      await supabase.from("team_members").delete().eq("user_id", userId);
      await supabase.from("user_roles").delete().eq("user_id", userId);

      // ── 2. INSERT time_entries ──
      if (emp.time_entries && emp.time_entries.length > 0) {
        const timeRows = emp.time_entries.map((t: any) => ({
          user_id: userId,
          date: t.date,
          start_time: t.start_time,
          end_time: t.end_time,
          break_minutes: t.break_minutes ?? 0,
          notes: t.notes || null,
          template_id: t.template_name ? templateNameMap.get(t.template_name) || null : null,
        }));

        // Insert in batches of 500 to avoid payload limits
        for (let i = 0; i < timeRows.length; i += 500) {
          const batch = timeRows.slice(i, i + 500);
          const { error } = await supabase.from("time_entries").insert(batch);
          if (error) throw new Error(`time_entries insert error: ${error.message}`);
        }
      }

      // ── 3. INSERT absences ──
      if (emp.absences && emp.absences.length > 0) {
        const absRows = emp.absences.map((a: any) => ({
          user_id: userId,
          type: a.type,
          start_date: a.start_date,
          end_date: a.end_date,
          status: a.status || "pending",
          is_half_day: a.is_half_day ?? false,
          notes: a.notes || null,
          approved_by: a.approved_by_email ? profileEmailMap.get(a.approved_by_email) || null : null,
          created_by: a.created_by_email ? profileEmailMap.get(a.created_by_email) || null : null,
          approved_at: a.approved_at || null,
          medical_certificate_status: a.medical_certificate_status || null,
          rejection_reason: a.rejection_reason || null,
        }));

        const { error } = await supabase.from("absences").insert(absRows);
        if (error) throw new Error(`absences insert error: ${error.message}`);
      }

      // ── 4. INSERT work_schedules ──
      if (emp.work_schedules && emp.work_schedules.length > 0) {
        const schedRows = emp.work_schedules.map((s: any) => ({
          user_id: userId,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          break_minutes: s.break_minutes ?? 0,
          valid_from: s.valid_from,
          valid_to: s.valid_to || null,
          is_active: s.is_active ?? true,
        }));

        const { error } = await supabase.from("employee_work_schedules").insert(schedRows);
        if (error) throw new Error(`work_schedules insert error: ${error.message}`);
      }

      // ── 5. INSERT balance_corrections ──
      if (emp.balance_corrections && emp.balance_corrections.length > 0) {
        const corrRows = emp.balance_corrections.map((c: any) => ({
          user_id: userId,
          correction_type: c.correction_type,
          effective_date: c.effective_date,
          hours_adjustment: c.hours_adjustment ?? null,
          vacation_days_adjustment: c.vacation_days_adjustment ?? null,
          reason: c.reason,
          applies_to_year: c.applies_to_year ?? null,
          created_by: c.created_by_email ? profileEmailMap.get(c.created_by_email) || userId : userId,
        }));

        const { error } = await supabase.from("balance_corrections").insert(corrRows);
        if (error) throw new Error(`balance_corrections insert error: ${error.message}`);
      }

      // ── 6. INSERT team_members ──
      if (emp.team_memberships && emp.team_memberships.length > 0) {
        const teamRows = emp.team_memberships
          .filter((t: any) => t.team_name && teamNameMap.has(t.team_name))
          .map((t: any) => ({
            user_id: userId,
            team_id: teamNameMap.get(t.team_name)!,
            is_active: t.is_active ?? true,
          }));

        if (teamRows.length > 0) {
          const { error } = await supabase.from("team_members").insert(teamRows);
          if (error) throw new Error(`team_members insert error: ${error.message}`);
        }

        const skippedTeams = emp.team_memberships
          .filter((t: any) => t.team_name && !teamNameMap.has(t.team_name))
          .map((t: any) => t.team_name);

        if (skippedTeams.length > 0) {
          results.push({
            email: emp.email,
            status: "warning",
            reason: `Teams not found: ${skippedTeams.join(", ")}`,
          });
        }
      }

      // ── 7. INSERT user_roles ──
      if (emp.roles && emp.roles.length > 0) {
        const roleRows = emp.roles.map((r: string) => ({
          user_id: userId,
          role: r,
        }));

        const { error } = await supabase.from("user_roles").insert(roleRows);
        if (error) throw new Error(`user_roles insert error: ${error.message}`);
      }

      // ── 8. UPDATE profile ──
      if (emp.profile) {
        const { error } = await supabase
          .from("profiles")
          .update({
            full_name: emp.profile.full_name,
            employee_number: emp.profile.employee_number ?? null,
            annual_vacation_days: emp.profile.annual_vacation_days ?? null,
            default_weekly_hours: emp.profile.default_weekly_hours ?? null,
            time_tracking_exempt: emp.profile.time_tracking_exempt ?? false,
            is_archived: emp.profile.is_archived ?? false,
          })
          .eq("id", userId);
        if (error) throw new Error(`profile update error: ${error.message}`);
      }

      results.push({
        email: emp.email,
        status: "imported",
        counts: {
          time_entries: emp.time_entries?.length ?? 0,
          absences: emp.absences?.length ?? 0,
          work_schedules: emp.work_schedules?.length ?? 0,
          balance_corrections: emp.balance_corrections?.length ?? 0,
          team_memberships: emp.team_memberships?.length ?? 0,
          roles: emp.roles?.length ?? 0,
        },
      });
    } catch (err) {
      results.push({
        email: emp.email,
        status: "error",
        reason: err.message || "Unknown error",
      });
    }
  }

  // Audit log
  await supabase.from("audit_logs").insert({
    user_id: user.id,
    user_email: user.email,
    action: "IMPORT",
    table_name: "data_transfer",
    description: `Data import for ${importData.employees.length} employee(s)`,
    new_values: { results },
  });

  return new Response(
    JSON.stringify({ results }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
