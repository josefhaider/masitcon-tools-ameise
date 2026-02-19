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

    // Verify the user is authenticated by getting user from JWT token
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
        JSON.stringify({ error: 'Nur Administratoren können Mitarbeiter anlegen' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { email, password, full_name, employee_number } = await req.json();

    // Validate input
    if (!email || !password || !full_name) {
      return new Response(
        JSON.stringify({ error: 'E-Mail, Passwort und Name sind erforderlich' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Passwort muss mindestens 6 Zeichen haben' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Create auth user
    console.log('Creating auth user for:', email);
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: full_name
      }
    });

    if (authError) {
      console.error('Auth user creation failed:', authError);
      if (authError.message.includes('already registered')) {
        return new Response(
          JSON.stringify({ error: 'Diese E-Mail-Adresse wird bereits verwendet' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw authError;
    }

    console.log('Auth user created:', authData.user.id);

    // Poll for profile creation by trigger (max 5s)
    let profileReady = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data: profile } = await adminClient
        .from('profiles')
        .select('id')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (profile) {
        profileReady = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!profileReady) {
      console.warn('Profile not created by trigger after 5s for:', authData.user.id);
    }

    if (employee_number && profileReady) {
      console.log('Updating profile for:', authData.user.id);
      const { error: profileError } = await adminClient
        .from('profiles')
        .update({ employee_number })
        .eq('id', authData.user.id);

      if (profileError) {
        console.error('Profile update failed:', profileError);
      }
    }

    console.log('Employee created successfully:', authData.user.id);

    return new Response(
      JSON.stringify({
        success: true,
        user_id: authData.user.id,
        email: authData.user.email
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in create-employee function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Ein Fehler ist aufgetreten';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
