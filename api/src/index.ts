import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createClient } from '@supabase/supabase-js'

// ─── CORS Helper ────────────────────────────────────────────────────────────
function getCorsHeaders(origin: string): Record<string, string> {
  const allowed = process.env.ALLOWED_ORIGIN || 'http://127.0.0.1:8080'
  const allowOrigin = origin === allowed ? origin : allowed
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  }
}

function setCors(c: any, origin: string) {
  const headers = getCorsHeaders(origin)
  for (const [k, v] of Object.entries(headers)) c.header(k, v)
}

const app = new Hono()

// ─── CORS Preflight ──────────────────────────────────────────────────────────
app.options('*', (c) => {
  const origin = c.req.header('origin') ?? ''
  setCors(c, origin)
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  return c.body(null, 204)
})

// ─── create-employee ─────────────────────────────────────────────────────────
app.post('/functions/v1/create-employee', async (c) => {
  const origin = c.req.header('origin') ?? ''
  setCors(c, origin)

  try {
    const authHeader = c.req.header('authorization')
    if (!authHeader) {
      return c.json({ error: 'No authorization header' }, 401)
    }

    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
    if (userError || !user) {
      console.error('User verification failed:', userError)
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { data: roles, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)

    if (rolesError || !roles || !roles.some((r: any) => r.role === 'admin')) {
      console.error('Admin check failed:', rolesError)
      return c.json({ error: 'Nur Administratoren können Mitarbeiter anlegen' }, 403)
    }

    const { email, password, full_name, employee_number } = await c.req.json()

    if (!email || !password || !full_name) {
      return c.json({ error: 'E-Mail, Passwort und Name sind erforderlich' }, 400)
    }
    if (password.length < 6) {
      return c.json({ error: 'Passwort muss mindestens 6 Zeichen haben' }, 400)
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    console.log('Creating auth user for:', email)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })

    if (authError) {
      console.error('Auth user creation failed:', authError)
      if (authError.message.includes('already registered')) {
        return c.json({ error: 'Diese E-Mail-Adresse wird bereits verwendet' }, 400)
      }
      throw authError
    }

    console.log('Auth user created:', authData.user.id)

    let profileReady = false
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('id')
        .eq('id', authData.user.id)
        .maybeSingle()
      if (profile) { profileReady = true; break }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (!profileReady) {
      console.warn('Profile not created by trigger after 5s for:', authData.user.id)
    }

    if (employee_number && profileReady) {
      console.log('Updating profile for:', authData.user.id)
      const { error: profileError } = await adminClient
        .from('profiles')
        .update({ employee_number })
        .eq('id', authData.user.id)
      if (profileError) console.error('Profile update failed:', profileError)
    }

    console.log('Employee created successfully:', authData.user.id)
    return c.json({
      success: true,
      user_id: authData.user.id,
      email: authData.user.email,
    }, 200)
  } catch (error) {
    console.error('Error in create-employee:', error)
    const errorMessage = error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten'
    return c.json({ error: errorMessage }, 500)
  }
})

// ─── admin-update-user ───────────────────────────────────────────────────────
app.post('/functions/v1/admin-update-user', async (c) => {
  const origin = c.req.header('origin') ?? ''
  setCors(c, origin)

  try {
    const authHeader = c.req.header('authorization')
    if (!authHeader) {
      return c.json({ error: 'No authorization header' }, 401)
    }

    const supabaseUrl = process.env.SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
    if (userError || !user) {
      console.error('User verification failed:', userError)
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const { data: roles, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)

    if (rolesError || !roles || !roles.some((r: any) => r.role === 'admin')) {
      console.error('Admin check failed:', rolesError)
      return c.json({ error: 'Nur Administratoren können Benutzerdaten ändern' }, 403)
    }

    const { action, target_user_id, new_email, new_password, confirmation_code } = await c.req.json()

    if (!action || !target_user_id) {
      return c.json({ error: 'Aktion und Benutzer-ID sind erforderlich' }, 400)
    }

    if (target_user_id === user.id && (action === 'update_email' || action === 'reset_password')) {
      return c.json({ error: 'Eigene E-Mail oder Passwort bitte über Profileinstellungen ändern' }, 400)
    }

    let result: Record<string, unknown>

    switch (action) {
      case 'update_email': {
        if (!new_email || !new_email.includes('@')) {
          return c.json({ error: 'Gültige E-Mail-Adresse erforderlich' }, 400)
        }
        console.log('Updating email for user:', target_user_id, 'to:', new_email)
        const { data: emailData, error: emailError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id, { email: new_email, email_confirm: true }
        )
        if (emailError) {
          console.error('Email update failed:', emailError)
          if (emailError.message.includes('already registered') || emailError.message.includes('duplicate')) {
            return c.json({ error: 'Diese E-Mail-Adresse wird bereits verwendet' }, 400)
          }
          throw emailError
        }
        await supabaseClient.from('profiles').update({ email: new_email }).eq('id', target_user_id)
        result = { success: true, message: 'E-Mail-Adresse aktualisiert', email: emailData.user.email }
        break
      }

      case 'reset_password': {
        if (!new_password || new_password.length < 6) {
          return c.json({ error: 'Passwort muss mindestens 6 Zeichen haben' }, 400)
        }
        console.log('Resetting password for user:', target_user_id)
        const { error: passwordError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id, { password: new_password }
        )
        if (passwordError) {
          console.error('Password reset failed:', passwordError)
          throw passwordError
        }
        result = { success: true, message: 'Passwort wurde zurückgesetzt' }
        break
      }

      case 'send_password_reset': {
        const { data: targetUser, error: targetUserError } = await supabaseClient.auth.admin.getUserById(target_user_id)
        if (targetUserError || !targetUser.user) {
          return c.json({ error: 'Benutzer nicht gefunden' }, 404)
        }
        console.log('Sending password reset email to:', targetUser.user.email)
        const { data: linkData, error: linkError } = await supabaseClient.auth.admin.generateLink({
          type: 'recovery', email: targetUser.user.email!,
        })
        if (linkError) {
          console.error('Failed to generate reset link:', linkError)
          throw linkError
        }
        result = {
          success: true,
          message: 'Passwort-Reset-Link generiert',
          reset_link: linkData.properties.action_link,
        }
        break
      }

      case 'archive_user': {
        console.log('Archiving user:', target_user_id)
        const { data: archiveUser, error: archiveUserError } = await supabaseClient.auth.admin.getUserById(target_user_id)
        if (archiveUserError || !archiveUser.user) {
          return c.json({ error: 'Benutzer nicht gefunden' }, 404)
        }
        if (target_user_id === user.id) {
          return c.json({ error: 'Sie können sich nicht selbst archivieren' }, 400)
        }
        const { error: banError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id, { ban_duration: '87600h' }
        )
        if (banError) { console.error('Failed to ban user:', banError); throw banError }
        const { error: profileError } = await supabaseClient.from('profiles').update({
          is_archived: true,
          archived_at: new Date().toISOString(),
          archived_by: user.id,
        }).eq('id', target_user_id)
        if (profileError) { console.error('Failed to update profile:', profileError); throw profileError }
        await supabaseClient.from('audit_logs').insert({
          user_id: user.id,
          user_email: user.email,
          action: 'UPDATE',
          table_name: 'profiles',
          record_id: target_user_id,
          old_values: { is_archived: false },
          new_values: { is_archived: true },
          description: `Mitarbeiter "${archiveUser.user.email}" archiviert`,
        })
        result = { success: true, message: 'Mitarbeiter wurde archiviert' }
        break
      }

      case 'unarchive_user': {
        console.log('Unarchiving user:', target_user_id)
        const { data: unarchiveUser, error: unarchiveUserError } = await supabaseClient.auth.admin.getUserById(target_user_id)
        if (unarchiveUserError || !unarchiveUser.user) {
          return c.json({ error: 'Benutzer nicht gefunden' }, 404)
        }
        const { error: unbanError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id, { ban_duration: 'none' }
        )
        if (unbanError) { console.error('Failed to unban user:', unbanError); throw unbanError }
        const { error: profileError } = await supabaseClient.from('profiles').update({
          is_archived: false,
          archived_at: null,
          archived_by: null,
        }).eq('id', target_user_id)
        if (profileError) { console.error('Failed to update profile:', profileError); throw profileError }
        await supabaseClient.from('audit_logs').insert({
          user_id: user.id,
          user_email: user.email,
          action: 'UPDATE',
          table_name: 'profiles',
          record_id: target_user_id,
          old_values: { is_archived: true },
          new_values: { is_archived: false },
          description: `Mitarbeiter "${unarchiveUser.user.email}" reaktiviert`,
        })
        result = { success: true, message: 'Mitarbeiter wurde reaktiviert' }
        break
      }

      case 'delete_user': {
        console.log('Attempting to delete user:', target_user_id)
        const { data: deleteUser, error: deleteUserError } = await supabaseClient.auth.admin.getUserById(target_user_id)
        if (deleteUserError || !deleteUser.user) {
          return c.json({ error: 'Benutzer nicht gefunden' }, 404)
        }
        if (target_user_id === user.id) {
          return c.json({ error: 'Sie können sich nicht selbst löschen' }, 400)
        }
        const { data: profileData } = await supabaseClient
          .from('profiles').select('full_name').eq('id', target_user_id).single()
        const employeeName = (profileData as any)?.full_name || ''
        const expectedCode = `LÖSCHEN-${employeeName}`
        if (!confirmation_code || confirmation_code !== expectedCode) {
          return c.json({
            error: 'Bestätigungscode stimmt nicht überein',
            expected_format: 'LÖSCHEN-[Mitarbeitername]',
          }, 400)
        }
        await supabaseClient.from('audit_logs').insert({
          user_id: user.id,
          user_email: user.email,
          action: 'DELETE',
          table_name: 'profiles',
          record_id: target_user_id,
          old_values: { full_name: employeeName, email: deleteUser.user.email },
          new_values: null,
          description: `Mitarbeiter "${employeeName}" (${deleteUser.user.email}) und alle zugehörigen Daten unwiderruflich gelöscht`,
        })
        await supabaseClient.from('time_entries').delete().eq('user_id', target_user_id)
        await supabaseClient.from('absences').delete().eq('user_id', target_user_id)
        await supabaseClient.from('balance_corrections').delete().eq('user_id', target_user_id)
        await supabaseClient.from('employee_work_schedules').delete().eq('user_id', target_user_id)
        await supabaseClient.from('team_members').delete().eq('user_id', target_user_id)
        await supabaseClient.from('user_roles').delete().eq('user_id', target_user_id)
        await supabaseClient.from('profiles').delete().eq('id', target_user_id)
        const { error: deleteAuthError } = await supabaseClient.auth.admin.deleteUser(target_user_id)
        if (deleteAuthError) {
          console.error('Failed to delete auth user:', deleteAuthError)
          throw deleteAuthError
        }
        result = {
          success: true,
          message: `Mitarbeiter "${employeeName}" und alle zugehörigen Daten wurden unwiderruflich gelöscht`,
        }
        break
      }

      default:
        return c.json({ error: 'Unbekannte Aktion' }, 400)
    }

    console.log('Action completed successfully:', action)
    return c.json(result, 200)
  } catch (error) {
    console.error('Error in admin-update-user:', error)
    const errorMessage = error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten'
    return c.json({ error: errorMessage }, 500)
  }
})

// ─── employee-data-transfer ──────────────────────────────────────────────────
app.post('/functions/v1/employee-data-transfer', async (c) => {
  const origin = c.req.header('origin') ?? ''
  setCors(c, origin)

  try {
    const supabaseUrl = process.env.SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const transferPassword = process.env.DATA_TRANSFER_PASSWORD

    if (!transferPassword) {
      return c.json({ error: 'DATA_TRANSFER_PASSWORD is not configured' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON in request body' }, 400)
    }

    const { action, password, user_email } = body as { action?: string; password?: string; user_email?: string }

    if (!user_email) {
      return c.json({ error: 'Missing user_email in request body' }, 400)
    }
    if (password !== transferPassword) {
      return c.json({ error: 'Invalid transfer password' }, 403)
    }

    const { data: userProfile } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', user_email)
      .maybeSingle()

    if (!userProfile) {
      return c.json({ error: 'User not found' }, 404)
    }

    const { data: adminRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', (userProfile as any).id)
      .eq('role', 'admin')
      .maybeSingle()

    if (!adminRole) {
      return c.json({ error: 'Unauthorized: Admin role required' }, 403)
    }

    const user = { id: (userProfile as any).id, email: (userProfile as any).email }

    if (action === 'export') {
      return await handleExport(supabase, body, user, supabaseUrl, c)
    } else if (action === 'import') {
      return await handleImport(supabase, body, user, c)
    } else {
      return c.json({ error: "Invalid action. Use 'export' or 'import'" }, 400)
    }
  } catch (error) {
    console.error('Data transfer error:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
})

// ─── HELPER: Build email lookup map ─────────────────────────────────────────
async function buildEmailMap(supabase: any, userIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()
  const { data: profiles } = await supabase.from('profiles').select('id, email').in('id', uniqueIds)
  const map = new Map<string, string>()
  for (const p of profiles || []) map.set(p.id, p.email)
  return map
}

async function buildTemplateNameMap(supabase: any, templateIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(templateIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()
  const { data: templates } = await supabase.from('time_templates').select('id, name').in('id', uniqueIds)
  const map = new Map<string, string>()
  for (const t of templates || []) map.set(t.id, t.name)
  return map
}

async function buildTeamNameMap(supabase: any, teamIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(teamIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()
  const { data: teams } = await supabase.from('teams').select('id, name').in('id', uniqueIds)
  const map = new Map<string, string>()
  for (const t of teams || []) map.set(t.id, t.name)
  return map
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────
async function handleExport(supabase: any, body: any, user: any, supabaseUrl: string, c: any) {
  const { employee_emails } = body
  if (!employee_emails || !Array.isArray(employee_emails) || employee_emails.length === 0) {
    return c.json({ error: 'employee_emails array is required' }, 400)
  }

  const employees: any[] = []
  const warnings: string[] = []

  for (const email of employee_emails) {
    const { data: profile } = await supabase.from('profiles').select('*').eq('email', email).maybeSingle()
    if (!profile) { warnings.push(`Employee not found: ${email}`); continue }
    const userId = profile.id
    const [timeRes, absRes, schedRes, corrRes, teamRes, rolesRes] = await Promise.all([
      supabase.from('time_entries').select('*').eq('user_id', userId).order('date'),
      supabase.from('absences').select('*').eq('user_id', userId).order('start_date'),
      supabase.from('employee_work_schedules').select('*').eq('user_id', userId).order('day_of_week'),
      supabase.from('balance_corrections').select('*').eq('user_id', userId).order('effective_date'),
      supabase.from('team_members').select('*').eq('user_id', userId),
      supabase.from('user_roles').select('*').eq('user_id', userId),
    ])
    const userIdsToResolve: string[] = []
    for (const a of absRes.data || []) {
      if (a.approved_by) userIdsToResolve.push(a.approved_by)
      if (a.created_by) userIdsToResolve.push(a.created_by)
    }
    for (const c of corrRes.data || []) { if (c.created_by) userIdsToResolve.push(c.created_by) }
    const emailMap = await buildEmailMap(supabase, userIdsToResolve)
    const templateIds = (timeRes.data || []).map((t: any) => t.template_id).filter(Boolean)
    const templateMap = await buildTemplateNameMap(supabase, templateIds)
    const teamIds = (teamRes.data || []).map((t: any) => t.team_id).filter(Boolean)
    const teamMap = await buildTeamNameMap(supabase, teamIds)
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
      roles: (rolesRes.data || []).map((r: any) => r.role),
      time_entries: (timeRes.data || []).map((t: any) => ({
        date: t.date, start_time: t.start_time, end_time: t.end_time,
        break_minutes: t.break_minutes, notes: t.notes,
        template_name: t.template_id ? templateMap.get(t.template_id) || null : null,
      })),
      absences: (absRes.data || []).map((a: any) => ({
        type: a.type, start_date: a.start_date, end_date: a.end_date,
        status: a.status, is_half_day: a.is_half_day, notes: a.notes,
        approved_by_email: a.approved_by ? emailMap.get(a.approved_by) || null : null,
        created_by_email: a.created_by ? emailMap.get(a.created_by) || null : null,
        approved_at: a.approved_at, medical_certificate_status: a.medical_certificate_status,
        rejection_reason: a.rejection_reason,
      })),
      work_schedules: (schedRes.data || []).map((s: any) => ({
        day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time,
        break_minutes: s.break_minutes, valid_from: s.valid_from, valid_to: s.valid_to,
        is_active: s.is_active,
      })),
      balance_corrections: (corrRes.data || []).map((c: any) => ({
        correction_type: c.correction_type, effective_date: c.effective_date,
        hours_adjustment: c.hours_adjustment, vacation_days_adjustment: c.vacation_days_adjustment,
        reason: c.reason, applies_to_year: c.applies_to_year,
        created_by_email: c.created_by ? emailMap.get(c.created_by) || null : null,
      })),
      team_memberships: (teamRes.data || [])
        .map((t: any) => ({ team_name: teamMap.get(t.team_id) || null, is_active: t.is_active }))
        .filter((t: any) => t.team_name !== null),
    })
  }

  const exportData = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    exported_by: user.email,
    source_url: supabaseUrl,
    employees,
  }

  await supabase.from('audit_logs').insert({
    user_id: user.id, user_email: user.email, action: 'EXPORT', table_name: 'data_transfer',
    description: `Data export for ${employees.length} employee(s): ${employee_emails.join(', ')}`,
    new_values: { employee_count: employees.length, emails: employee_emails },
  })

  return c.json({ data: exportData, warnings }, 200)
}

// ─── IMPORT ──────────────────────────────────────────────────────────────────
async function handleImport(supabase: any, body: any, user: any, c: any) {
  const { data: importData } = body
  if (!importData || !importData.employees || !Array.isArray(importData.employees)) {
    return c.json({ error: 'Invalid import data structure' }, 400)
  }

  const { data: allProfiles } = await supabase.from('profiles').select('id, email')
  const profileEmailMap = new Map<string, string>()
  for (const p of allProfiles || []) profileEmailMap.set(p.email, p.id)

  const { data: allTeams } = await supabase.from('teams').select('id, name')
  const teamNameMap = new Map<string, string>()
  for (const t of allTeams || []) teamNameMap.set(t.name, t.id)

  const { data: allTemplates } = await supabase.from('time_templates').select('id, name')
  const templateNameMap = new Map<string, string>()
  for (const t of allTemplates || []) templateNameMap.set(t.name, t.id)

  const results: any[] = []

  for (const emp of importData.employees) {
    const userId = profileEmailMap.get(emp.email)
    if (!userId) {
      results.push({ email: emp.email, status: 'skipped', reason: 'Employee not found in target environment' })
      continue
    }

    try {
      await supabase.from('time_entries').delete().eq('user_id', userId)
      await supabase.from('absences').delete().eq('user_id', userId)
      await supabase.from('balance_corrections').delete().eq('user_id', userId)
      await supabase.from('employee_work_schedules').delete().eq('user_id', userId)
      await supabase.from('team_members').delete().eq('user_id', userId)
      await supabase.from('user_roles').delete().eq('user_id', userId)

      if (emp.time_entries && emp.time_entries.length > 0) {
        const timeRows = emp.time_entries.map((t: any) => ({
          user_id: userId, date: t.date, start_time: t.start_time, end_time: t.end_time,
          break_minutes: t.break_minutes ?? 0, notes: t.notes || null,
          template_id: t.template_name ? templateNameMap.get(t.template_name) || null : null,
        }))
        for (let i = 0; i < timeRows.length; i += 500) {
          const { error } = await supabase.from('time_entries').insert(timeRows.slice(i, i + 500))
          if (error) throw new Error(`time_entries insert error: ${error.message}`)
        }
      }

      if (emp.absences && emp.absences.length > 0) {
        const absRows = emp.absences.map((a: any) => ({
          user_id: userId, type: a.type, start_date: a.start_date, end_date: a.end_date,
          status: a.status || 'pending', is_half_day: a.is_half_day ?? false, notes: a.notes || null,
          approved_by: a.approved_by_email ? profileEmailMap.get(a.approved_by_email) || null : null,
          created_by: a.created_by_email ? profileEmailMap.get(a.created_by_email) || null : null,
          approved_at: a.approved_at || null,
          medical_certificate_status: a.medical_certificate_status || null,
          rejection_reason: a.rejection_reason || null,
        }))
        const { error } = await supabase.from('absences').insert(absRows)
        if (error) throw new Error(`absences insert error: ${error.message}`)
      }

      if (emp.work_schedules && emp.work_schedules.length > 0) {
        const schedRows = emp.work_schedules.map((s: any) => ({
          user_id: userId, day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time,
          break_minutes: s.break_minutes ?? 0, valid_from: s.valid_from,
          valid_to: s.valid_to || null, is_active: s.is_active ?? true,
        }))
        const { error } = await supabase.from('employee_work_schedules').insert(schedRows)
        if (error) throw new Error(`work_schedules insert error: ${error.message}`)
      }

      if (emp.balance_corrections && emp.balance_corrections.length > 0) {
        const corrRows = emp.balance_corrections.map((c: any) => ({
          user_id: userId, correction_type: c.correction_type, effective_date: c.effective_date,
          hours_adjustment: c.hours_adjustment ?? null, vacation_days_adjustment: c.vacation_days_adjustment ?? null,
          reason: c.reason, applies_to_year: c.applies_to_year ?? null,
          created_by: c.created_by_email ? profileEmailMap.get(c.created_by_email) || userId : userId,
        }))
        const { error } = await supabase.from('balance_corrections').insert(corrRows)
        if (error) throw new Error(`balance_corrections insert error: ${error.message}`)
      }

      if (emp.team_memberships && emp.team_memberships.length > 0) {
        const teamRows = emp.team_memberships
          .filter((t: any) => t.team_name && teamNameMap.has(t.team_name))
          .map((t: any) => ({ user_id: userId, team_id: teamNameMap.get(t.team_name)!, is_active: t.is_active ?? true }))
        if (teamRows.length > 0) {
          const { error } = await supabase.from('team_members').insert(teamRows)
          if (error) throw new Error(`team_members insert error: ${error.message}`)
        }
        const skippedTeams = emp.team_memberships
          .filter((t: any) => t.team_name && !teamNameMap.has(t.team_name))
          .map((t: any) => t.team_name)
        if (skippedTeams.length > 0) {
          results.push({ email: emp.email, status: 'warning', reason: `Teams not found: ${skippedTeams.join(', ')}` })
        }
      }

      if (emp.roles && emp.roles.length > 0) {
        const roleRows = emp.roles.map((r: string) => ({ user_id: userId, role: r }))
        const { error } = await supabase.from('user_roles').insert(roleRows)
        if (error) throw new Error(`user_roles insert error: ${error.message}`)
      }

      if (emp.profile) {
        const { error } = await supabase.from('profiles').update({
          full_name: emp.profile.full_name, employee_number: emp.profile.employee_number ?? null,
          annual_vacation_days: emp.profile.annual_vacation_days ?? null,
          default_weekly_hours: emp.profile.default_weekly_hours ?? null,
          time_tracking_exempt: emp.profile.time_tracking_exempt ?? false,
          is_archived: emp.profile.is_archived ?? false,
        }).eq('id', userId)
        if (error) throw new Error(`profile update error: ${error.message}`)
      }

      results.push({
        email: emp.email,
        status: 'imported',
        counts: {
          time_entries: emp.time_entries?.length ?? 0,
          absences: emp.absences?.length ?? 0,
          work_schedules: emp.work_schedules?.length ?? 0,
          balance_corrections: emp.balance_corrections?.length ?? 0,
          team_memberships: emp.team_memberships?.length ?? 0,
          roles: emp.roles?.length ?? 0,
        },
      })
    } catch (err: unknown) {
      results.push({ email: emp.email, status: 'error', reason: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  await supabase.from('audit_logs').insert({
    user_id: user.id, user_email: user.email, action: 'IMPORT', table_name: 'data_transfer',
    description: `Data import for ${importData.employees.length} employee(s)`,
    new_values: { results },
  })

  return c.json({ results }, 200)
}

// ─── Server starten ──────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '3200', 10)
serve({ fetch: app.fetch, port }, () => {
  console.log(`Ameise API läuft auf Port ${port}`)
})
