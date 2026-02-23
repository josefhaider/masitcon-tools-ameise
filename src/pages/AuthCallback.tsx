import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/AuthLayout';
import { AuthCardFooter } from '@/components/AuthCardFooter';

// Verarbeitet alle GoTrue Callbacks (Password-Recovery, E-Mail-Bestätigung, etc.)
// GoTrue leitet nach diesem Muster weiter:
//   ?token_hash=XXX&type=recovery  (PKCE/OTP flow)
//   #access_token=XXX&type=recovery (implicit flow)
// Supabase JS v2 mit detectSessionInUrl: true verarbeitet beides automatisch.

const AuthCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.substring(1));

    const errorCode = searchParams.get('error') || hashParams.get('error');
    const errorDesc = searchParams.get('error_description') || hashParams.get('error_description');

    if (errorCode) {
      setError(errorDesc || errorCode);
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/auth/new-password', { replace: true });
      } else if (event === 'SIGNED_IN') {
        navigate('/', { replace: true });
      } else if (event === 'USER_UPDATED') {
        navigate('/', { replace: true });
      }
    });

    const timeout = setTimeout(() => {
      setError('Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.');
    }, 8000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white/95 backdrop-blur-xl shadow-2xl overflow-hidden">
          {/* Mascot + Titel */}
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

          {/* Status-Bereich */}
          <div className="px-8 pb-8">
            {error ? (
              <div className="space-y-4 text-center">
                <div className="rounded-xl bg-red-50 border border-red-200 p-4">
                  <p className="text-sm font-semibold text-red-700 mb-1">Link ungültig</p>
                  <p className="text-xs text-red-600">{error}</p>
                </div>
                <a
                  href="/auth"
                  className="block text-xs text-gray-500 hover:text-masitcon-turquoise transition-colors"
                >
                  ← Zurück zur Anmeldung
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-2">
                <Loader2 className="h-8 w-8 animate-spin text-masitcon-turquoise" />
                <p className="text-sm text-gray-500">Einen Moment bitte...</p>
              </div>
            )}
          </div>

          <AuthCardFooter />
        </div>
      </div>
    </AuthLayout>
  );
};

export default AuthCallback;
