"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { AuthCardFooter } from "@/components/AuthCardFooter";

export default function AuthNewPasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const resolved = useRef(false);

  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 5;
    const retryDelay = 800;

    const checkSession = async (): Promise<boolean> => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return !!session;
    };

    const tryResolve = async () => {
      if (resolved.current) return;

      const hasSession = await checkSession();
      if (hasSession) {
        resolved.current = true;
        setChecking(false);
        return;
      }

      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(tryResolve, retryDelay);
      } else {
        resolved.current = true;
        router.replace("/login");
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        resolved.current = true;
        setChecking(false);
      }
    });

    tryResolve();

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwörter stimmen nicht überein");
      return;
    }

    if (newPassword.length < 8) {
      toast.error("Passwort muss mindestens 8 Zeichen haben");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      toast.error("Passwort konnte nicht geändert werden", {
        description: error.message,
      });
    } else {
      toast.success("Passwort erfolgreich geändert");
      router.replace("/");
    }
    setLoading(false);
  };

  if (checking) {
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
            <div className="flex flex-col items-center gap-3 px-8 pb-8 py-2">
              <Loader2 className="h-8 w-8 animate-spin text-masitcon-turquoise" />
              <p className="text-sm text-gray-500">Session wird geladen...</p>
            </div>
            <AuthCardFooter />
          </div>
        </div>
      </AuthLayout>
    );
  }

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
            <p className="mb-4 text-center text-xs text-gray-500">
              Legen Sie ein neues Passwort für Ihr Konto fest.
            </p>
            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="new-password"
                  className="text-xs font-semibold uppercase tracking-wide text-gray-600"
                >
                  Neues Passwort
                </Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={8}
                    required
                    className="h-10 border-gray-200 bg-gray-50 pr-10 transition-colors focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    tabIndex={-1}
                    aria-label={
                      showNew ? "Passwort verbergen" : "Passwort anzeigen"
                    }
                  >
                    {showNew ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="confirm-password"
                  className="text-xs font-semibold uppercase tracking-wide text-gray-600"
                >
                  Passwort bestätigen
                </Label>
                <div className="relative">
                  <Input
                    id="confirm-password"
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={8}
                    required
                    className="h-10 border-gray-200 bg-gray-50 pr-10 transition-colors focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    tabIndex={-1}
                    aria-label={
                      showConfirm
                        ? "Passwort verbergen"
                        : "Passwort anzeigen"
                    }
                  >
                    {showConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="h-10 w-full bg-masitcon-turquoise text-sm font-semibold shadow-md transition-all duration-200 hover:bg-masitcon-turquoise/90"
                disabled={loading}
              >
                {loading ? "Wird gespeichert..." : "Passwort ändern"}
              </Button>
            </form>
          </div>

          <AuthCardFooter />
        </div>
      </div>
    </AuthLayout>
  );
}
