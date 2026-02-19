import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = Deno.env.get('ALLOWED_ORIGIN') || 'http://127.0.0.1:8080';
  const allowOrigin = origin === allowed ? origin : allowed;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create client with service role key for admin operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Verify the user is authenticated
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      console.error('User verification failed:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user has admin role
    const { data: roles, error: rolesError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (rolesError || !roles || !roles.some(r => r.role === 'admin')) {
      console.error('Admin check failed:', rolesError);
      return new Response(
        JSON.stringify({ error: 'Nur Administratoren können Benutzerdaten ändern' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { action, target_user_id, new_email, new_password, confirmation_code } = await req.json();

    // Validate input
    if (!action || !target_user_id) {
      return new Response(
        JSON.stringify({ error: 'Aktion und Benutzer-ID sind erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent self-modification of email/password (for safety)
    if (target_user_id === user.id && (action === 'update_email' || action === 'reset_password')) {
      return new Response(
        JSON.stringify({ error: 'Eigene E-Mail oder Passwort bitte über Profileinstellungen ändern' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let result;

    switch (action) {
      case 'update_email':
        if (!new_email || !new_email.includes('@')) {
          return new Response(
            JSON.stringify({ error: 'Gültige E-Mail-Adresse erforderlich' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Updating email for user:', target_user_id, 'to:', new_email);
        
        const { data: emailData, error: emailError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id,
          { email: new_email, email_confirm: true }
        );

        if (emailError) {
          console.error('Email update failed:', emailError);
          if (emailError.message.includes('already registered') || emailError.message.includes('duplicate')) {
            return new Response(
              JSON.stringify({ error: 'Diese E-Mail-Adresse wird bereits verwendet' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw emailError;
        }

        // Also update email in profiles table
        await supabaseClient
          .from('profiles')
          .update({ email: new_email })
          .eq('id', target_user_id);

        result = { success: true, message: 'E-Mail-Adresse aktualisiert', email: emailData.user.email };
        break;

      case 'reset_password':
        if (!new_password || new_password.length < 6) {
          return new Response(
            JSON.stringify({ error: 'Passwort muss mindestens 6 Zeichen haben' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Resetting password for user:', target_user_id);
        
        const { error: passwordError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id,
          { password: new_password }
        );

        if (passwordError) {
          console.error('Password reset failed:', passwordError);
          throw passwordError;
        }

        result = { success: true, message: 'Passwort wurde zurückgesetzt' };
        break;

      case 'send_password_reset':
        // Get user email first
        const { data: targetUser, error: targetUserError } = await supabaseClient.auth.admin.getUserById(target_user_id);
        
        if (targetUserError || !targetUser.user) {
          return new Response(
            JSON.stringify({ error: 'Benutzer nicht gefunden' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Sending password reset email to:', targetUser.user.email);
        
        // Generate password reset link
        const { data: linkData, error: linkError } = await supabaseClient.auth.admin.generateLink({
          type: 'recovery',
          email: targetUser.user.email!,
        });

        if (linkError) {
          console.error('Failed to generate reset link:', linkError);
          throw linkError;
        }

        result = { 
          success: true, 
          message: 'Passwort-Reset-Link generiert',
          reset_link: linkData.properties.action_link 
        };
        break;

      case 'archive_user': {
        console.log('Archiving user:', target_user_id);
        
        // Get user info first
        const { data: archiveUser, error: archiveUserError } = await supabaseClient.auth.admin.getUserById(target_user_id);
        
        if (archiveUserError || !archiveUser.user) {
          return new Response(
            JSON.stringify({ error: 'Benutzer nicht gefunden' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Prevent archiving self
        if (target_user_id === user.id) {
          return new Response(
            JSON.stringify({ error: 'Sie können sich nicht selbst archivieren' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Ban the user (disable login)
        const { error: banError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id,
          { ban_duration: '87600h' } // 10 years
        );

        if (banError) {
          console.error('Failed to ban user:', banError);
          throw banError;
        }

        // Update profile to mark as archived
        const { error: profileError } = await supabaseClient
          .from('profiles')
          .update({
            is_archived: true,
            archived_at: new Date().toISOString(),
            archived_by: user.id,
          })
          .eq('id', target_user_id);

        if (profileError) {
          console.error('Failed to update profile:', profileError);
          throw profileError;
        }

        // Create audit log
        await supabaseClient.from('audit_logs').insert({
          user_id: user.id,
          user_email: user.email,
          action: 'UPDATE',
          table_name: 'profiles',
          record_id: target_user_id,
          old_values: { is_archived: false },
          new_values: { is_archived: true },
          description: `Mitarbeiter "${archiveUser.user.email}" archiviert`,
        });

        result = { success: true, message: 'Mitarbeiter wurde archiviert' };
        break;
      }

      case 'unarchive_user': {
        console.log('Unarchiving user:', target_user_id);
        
        // Get user info first
        const { data: unarchiveUser, error: unarchiveUserError } = await supabaseClient.auth.admin.getUserById(target_user_id);
        
        if (unarchiveUserError || !unarchiveUser.user) {
          return new Response(
            JSON.stringify({ error: 'Benutzer nicht gefunden' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Unban the user (enable login)
        const { error: unbanError } = await supabaseClient.auth.admin.updateUserById(
          target_user_id,
          { ban_duration: 'none' }
        );

        if (unbanError) {
          console.error('Failed to unban user:', unbanError);
          throw unbanError;
        }

        // Update profile to mark as not archived
        const { error: profileError } = await supabaseClient
          .from('profiles')
          .update({
            is_archived: false,
            archived_at: null,
            archived_by: null,
          })
          .eq('id', target_user_id);

        if (profileError) {
          console.error('Failed to update profile:', profileError);
          throw profileError;
        }

        // Create audit log
        await supabaseClient.from('audit_logs').insert({
          user_id: user.id,
          user_email: user.email,
          action: 'UPDATE',
          table_name: 'profiles',
          record_id: target_user_id,
          old_values: { is_archived: true },
          new_values: { is_archived: false },
          description: `Mitarbeiter "${unarchiveUser.user.email}" reaktiviert`,
        });

        result = { success: true, message: 'Mitarbeiter wurde reaktiviert' };
        break;
      }

      case 'delete_user': {
        console.log('Attempting to delete user:', target_user_id);
        
        // Get user info first
        const { data: deleteUser, error: deleteUserError } = await supabaseClient.auth.admin.getUserById(target_user_id);
        
        if (deleteUserError || !deleteUser.user) {
          return new Response(
            JSON.stringify({ error: 'Benutzer nicht gefunden' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Prevent deleting self
        if (target_user_id === user.id) {
          return new Response(
            JSON.stringify({ error: 'Sie können sich nicht selbst löschen' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get profile name for confirmation check
        const { data: profileData } = await supabaseClient
          .from('profiles')
          .select('full_name')
          .eq('id', target_user_id)
          .single();

        const employeeName = profileData?.full_name || '';
        const expectedCode = `LÖSCHEN-${employeeName}`;

        // Validate confirmation code
        if (!confirmation_code || confirmation_code !== expectedCode) {
          return new Response(
            JSON.stringify({ 
              error: 'Bestätigungscode stimmt nicht überein',
              expected_format: `LÖSCHEN-[Mitarbeitername]`
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create audit log BEFORE deleting
        await supabaseClient.from('audit_logs').insert({
          user_id: user.id,
          user_email: user.email,
          action: 'DELETE',
          table_name: 'profiles',
          record_id: target_user_id,
          old_values: { 
            full_name: employeeName, 
            email: deleteUser.user.email 
          },
          new_values: null,
          description: `Mitarbeiter "${employeeName}" (${deleteUser.user.email}) und alle zugehörigen Daten unwiderruflich gelöscht`,
        });

        // Delete all related data in correct order
        console.log('Deleting time_entries...');
        await supabaseClient.from('time_entries').delete().eq('user_id', target_user_id);

        console.log('Deleting absences...');
        await supabaseClient.from('absences').delete().eq('user_id', target_user_id);

        console.log('Deleting balance_corrections...');
        await supabaseClient.from('balance_corrections').delete().eq('user_id', target_user_id);

        console.log('Deleting employee_work_schedules...');
        await supabaseClient.from('employee_work_schedules').delete().eq('user_id', target_user_id);

        console.log('Deleting team_members...');
        await supabaseClient.from('team_members').delete().eq('user_id', target_user_id);

        console.log('Deleting user_roles...');
        await supabaseClient.from('user_roles').delete().eq('user_id', target_user_id);

        console.log('Deleting profile...');
        await supabaseClient.from('profiles').delete().eq('id', target_user_id);

        console.log('Deleting auth user...');
        const { error: deleteAuthError } = await supabaseClient.auth.admin.deleteUser(target_user_id);

        if (deleteAuthError) {
          console.error('Failed to delete auth user:', deleteAuthError);
          throw deleteAuthError;
        }

        result = { 
          success: true, 
          message: `Mitarbeiter "${employeeName}" und alle zugehörigen Daten wurden unwiderruflich gelöscht` 
        };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Unbekannte Aktion' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    console.log('Action completed successfully:', action);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in admin-update-user function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
