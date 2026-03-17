"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { AuthCardFooter } from "@/components/AuthCardFooter";

/**
 * Fallback fuer Hash-Fragment-basierte Callbacks (#access_token=...&type=recovery).
 * Der primaere Flow laeuft ueber den Server-Route-Handler (route.ts),
 * der Query-Parameter (code, token_hash) verarbeitet.
 * Diese Page greift nur, wenn GoTrue mit Implicit Flow antwortet.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    const errorCode = searchParams.get("error") || hashParams.get("error");
    const errorDesc =
      searchParams.get("error_description") ||
      hashParams.get("error_description");

    if (errorCode) {
      setError(errorDesc || errorCode);
      return;
    }

    const hasHashTokens =
      hashParams.has("access_token") || hashParams.has("refresh_token");

    if (!hasHashTokens) {
      setError(
        "Kein Authentifizierungs-Token gefunden. Bitte fordern Sie einen neuen Link an.",
      );
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED" | "PASSWORD_RECOVERY" | "MFA_CHALLENGE_VERIFIED") => {
      if (event === "PASSWORD_RECOVERY") {
        router.replace("/auth/new-password");
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        router.replace("/");
      }
    });

    const timeout = setTimeout(() => {
      setError(
        "Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.",
      );
    }, 15000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [router]);

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl bg-white/95 shadow-2xl backdrop-blur-xl">
          <div className="flex flex-col items-center px-8 pb-6 pt-8">
            <img
              src="/Ameise.png"
              alt="Ameise"
              className="mb-2 h-56 w-auto object-contain drop-shadow-xl"
            />
            <h1 className="text-2xl font-bold uppercase tracking-widest text-gray-800">
              Ameise
            </h1>
            <p className="mt-0.5 text-xs tracking-wide text-gray-500">
              Masitcon Zeiterfassung
            </p>
          </div>

          <div className="px-8 pb-8">
            {error ? (
              <div className="space-y-4 text-center">
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <p className="mb-1 text-sm font-semibold text-red-700">
                    Link ungültig
                  </p>
                  <p className="text-xs text-red-600">{error}</p>
                </div>
                <a
                  href="/login"
                  className="block text-xs text-gray-500 transition-colors hover:text-masitcon-turquoise"
                >
                  &larr; Zurück zur Anmeldung
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-2">
                <Loader2 className="h-8 w-8 animate-spin text-masitcon-turquoise" />
                <p className="text-sm text-gray-500">
                  Einen Moment bitte...
                </p>
              </div>
            )}
          </div>

          <AuthCardFooter />
        </div>
      </div>
    </AuthLayout>
  );
}
