"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { AuthLayout } from "@/components/AuthLayout";
import { AuthCardFooter } from "@/components/AuthCardFooter";

type View = "login" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("login");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.replace("/");
      }
    });
  }, [router]);

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error("Anmeldung fehlgeschlagen", { description: error.message });
    } else {
      toast.success("Erfolgreich angemeldet");
      router.push("/");
    }

    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/auth/confirm`,
    });

    if (error) {
      toast.error("Fehler beim Senden der E-Mail", {
        description: error.message,
      });
    } else {
      setForgotSent(true);
    }

    setLoading(false);
  };

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="flex flex-col items-center pt-8 pb-6 px-8">
            <img
              src="/Ameise.png"
              alt="Ameise"
              className="mb-2 h-56 w-auto object-contain drop-shadow-xl"
            />
            <h1 className="text-2xl font-bold tracking-widest text-gray-800 uppercase">
              Ameise
            </h1>
            <p className="mt-0.5 text-xs text-gray-500 tracking-wide">
              Masitcon Zeiterfassung
            </p>
          </div>

          <div className="px-8 pb-8">
            {view === "login" ? (
              <form
                onSubmit={handleSignIn}
                method="post"
                className="space-y-4"
              >
                {/* method="post": Falls der onSubmit-Handler mal nicht greift
                    (z.B. vor abgeschlossener Hydration), verhindert dies, dass
                    E-Mail/Passwort per nativem GET im Klartext in die URL geraten. */}
                <div className="space-y-1.5">
                  <Label
                    htmlFor="signin-email"
                    className="text-xs font-semibold text-gray-600 uppercase tracking-wide"
                  >
                    E-Mail
                  </Label>
                  <div className="relative">
                    <Input
                      id="signin-email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      placeholder="name@firma.de"
                      required
                      className="h-10 border-gray-200 bg-gray-50 focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="signin-password"
                    className="text-xs font-semibold text-gray-600 uppercase tracking-wide"
                  >
                    Passwort
                  </Label>
                  <div className="relative">
                    <Input
                      id="signin-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Ihr Passwort"
                      required
                      className="h-10 border-gray-200 bg-gray-50 focus:bg-white pr-10 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      tabIndex={-1}
                      aria-label={
                        showPassword
                          ? "Passwort verbergen"
                          : "Passwort anzeigen"
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full h-10 text-sm font-semibold bg-masitcon-turquoise hover:bg-masitcon-turquoise/90 shadow-md transition-all duration-200"
                  disabled={loading}
                >
                  {loading ? "Wird angemeldet..." : "Anmelden"}
                </Button>

                <div className="flex justify-between items-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setView("forgot");
                      setForgotSent(false);
                      setForgotEmail("");
                    }}
                    className="text-xs text-gray-500 hover:text-masitcon-turquoise transition-colors"
                  >
                    Passwort vergessen?
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                {forgotSent ? (
                  <div className="space-y-4 text-center">
                    <div className="rounded-xl bg-green-50 border border-green-200 p-4">
                      <p className="text-sm font-semibold text-green-700 mb-1">
                        E-Mail versendet
                      </p>
                      <p className="text-xs text-green-600">
                        Bitte prüfen Sie Ihr Postfach und folgen Sie dem Link.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setView("login");
                        setForgotSent(false);
                        setForgotEmail("");
                      }}
                      className="text-xs text-gray-500 hover:text-masitcon-turquoise transition-colors"
                    >
                      &larr; Zurück zur Anmeldung
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={handleForgotPassword}
                    method="post"
                    className="space-y-4"
                  >
                    <p className="text-xs text-gray-500 text-center">
                      Geben Sie Ihre E-Mail ein – wir senden Ihnen einen
                      Reset-Link.
                    </p>
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="forgot-email"
                        className="text-xs font-semibold text-gray-600 uppercase tracking-wide"
                      >
                        E-Mail
                      </Label>
                      <Input
                        id="forgot-email"
                        type="email"
                        autoComplete="username"
                        placeholder="name@firma.de"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        required
                        className="h-10 border-gray-200 bg-gray-50 focus:bg-white transition-colors"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-10 text-sm font-semibold bg-masitcon-turquoise hover:bg-masitcon-turquoise/90 shadow-md transition-all duration-200"
                      disabled={loading}
                    >
                      {loading ? "Wird gesendet..." : "Reset-Link senden"}
                    </Button>
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => setView("login")}
                        className="text-xs text-gray-500 hover:text-masitcon-turquoise transition-colors"
                      >
                        &larr; Zurück zur Anmeldung
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          <AuthCardFooter />
        </div>
      </div>
    </AuthLayout>
  );
}
