import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/integrations/supabase/types";

/**
 * Server-seitiger Auth-Callback fuer PKCE code exchange und token_hash/type OTP-Verifizierung.
 * Setzt die Session serverseitig in Cookies und redirected dann zur richtigen Seite.
 *
 * Wird aufgerufen von:
 * - GoTrue /auth/v1/verify mit ?code= (PKCE Flow)
 * - Direktlinks mit ?token_hash=...&type=recovery (OTP Flow)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/";

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = next;
  redirectTo.searchParams.delete("code");
  redirectTo.searchParams.delete("token_hash");
  redirectTo.searchParams.delete("type");
  redirectTo.searchParams.delete("next");

  if (!code && !tokenHash) {
    redirectTo.pathname = "/login";
    return NextResponse.redirect(redirectTo);
  }

  const response = NextResponse.redirect(redirectTo);

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  let isRecovery = type === "recovery";

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/confirm] Code exchange failed:", error.message);
      redirectTo.pathname = "/login";
      redirectTo.searchParams.set("error", "auth_error");
      return NextResponse.redirect(redirectTo, { headers: response.headers });
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "recovery" | "email" | "signup" | "invite",
    });
    if (error) {
      console.error("[auth/confirm] OTP verification failed:", error.message);
      redirectTo.pathname = "/login";
      redirectTo.searchParams.set("error", "auth_error");
      return NextResponse.redirect(redirectTo, { headers: response.headers });
    }
    isRecovery = type === "recovery";
  }

  if (isRecovery) {
    redirectTo.pathname = "/auth/new-password";
  }

  return NextResponse.redirect(redirectTo, { headers: response.headers });
}
