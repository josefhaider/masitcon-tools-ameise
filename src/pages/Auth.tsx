import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Clock, Plane, Thermometer, BarChart3 } from 'lucide-react';
import masitconLogo from '@/assets/masitcon-logo.png';

// SVG Wave component for visual interest
const WaveDecoration = ({ className = '' }: { className?: string }) => (
  <svg 
    className={className}
    viewBox="0 0 1440 320" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="none"
  >
    <path 
      d="M0,192L48,197.3C96,203,192,213,288,229.3C384,245,480,267,576,250.7C672,235,768,181,864,181.3C960,181,1056,235,1152,234.7C1248,235,1344,181,1392,154.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z" 
      fill="rgba(255,255,255,0.1)"
    />
    <path 
      d="M0,256L48,261.3C96,267,192,277,288,272C384,267,480,245,576,234.7C672,224,768,224,864,229.3C960,235,1056,245,1152,234.7C1248,224,1344,192,1392,176L1440,160L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z" 
      fill="rgba(255,255,255,0.15)"
    />
  </svg>
);

// Animated floating blob
const FloatingBlob = ({ className = '', delay = 0 }: { className?: string; delay?: number }) => (
  <div 
    className={`absolute rounded-full blur-3xl opacity-30 animate-pulse ${className}`}
    style={{ animationDelay: `${delay}s`, animationDuration: '4s' }}
  />
);

type View = 'login' | 'forgot';

const Auth = () => {
  const navigate = useNavigate();
  const { signIn, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('login');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Redirect if already logged in
  if (user) {
    navigate('/');
    return null;
  }

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    const { error } = await signIn(email, password);

    if (error) {
      toast.error('Anmeldung fehlgeschlagen', {
        description: error.message,
      });
    } else {
      toast.success('Erfolgreich angemeldet');
      navigate('/');
    }

    setLoading(false);
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });

    if (error) {
      toast.error('Fehler beim Senden der E-Mail', {
        description: error.message,
      });
    } else {
      setForgotSent(true);
    }
    setLoading(false);
  };

  const features = [
    { icon: Clock, title: 'Präzise Zeiterfassung', description: 'Stunden einfach und genau erfassen' },
    { icon: Plane, title: 'Urlaubsverwaltung', description: 'Anträge digital stellen und genehmigen' },
    { icon: Thermometer, title: 'Krankmeldungen', description: 'Abwesenheiten unkompliziert melden' },
    { icon: BarChart3, title: 'Reports & Auswertungen', description: 'Detaillierte Übersichten auf Knopfdruck' },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Left side - Branding with modern gradient and effects */}
      <div className="hidden lg:flex lg:w-[55%] flex-col justify-center items-center p-12 relative overflow-hidden bg-gradient-to-br from-masitcon-darkblue via-masitcon-lightblue to-masitcon-turquoise">
        {/* Animated floating blobs for depth */}
        <FloatingBlob className="w-96 h-96 bg-masitcon-turquoise -top-20 -left-20" delay={0} />
        <FloatingBlob className="w-72 h-72 bg-masitcon-lightblue top-1/3 -right-10" delay={1} />
        <FloatingBlob className="w-64 h-64 bg-white/20 bottom-20 left-1/4" delay={2} />
        
        {/* Decorative circles */}
        <div className="absolute top-20 right-20 w-32 h-32 rounded-full border border-white/20" />
        <div className="absolute bottom-40 left-10 w-20 h-20 rounded-full border border-white/10" />
        <div className="absolute top-1/2 right-1/4 w-16 h-16 rounded-full bg-white/5" />
        
        {/* SVG Wave decoration at bottom */}
        <WaveDecoration className="absolute bottom-0 left-0 w-full h-40" />
        
        <div className="relative z-10 max-w-lg text-center">
          <img 
            src={masitconLogo} 
            alt="masitcon" 
            className="h-20 w-auto object-contain mb-8 mx-auto brightness-0 invert drop-shadow-lg"
          />
          
          <h1 className="text-5xl font-bold text-white mb-4 drop-shadow-md">
            Zeiterfassung
          </h1>
          
          <p className="text-xl text-white/90 mb-12 font-light">
            Einfach. Präzise. Effizient.
          </p>
          
          {/* Glassmorphism Feature Cards */}
          <div className="grid grid-cols-1 gap-4 text-left">
            {features.map((feature, index) => (
              <div 
                key={index} 
                className="flex items-start gap-4 rounded-xl p-4 backdrop-blur-md bg-white/10 border border-white/20 shadow-lg transition-all duration-300 hover:bg-white/15 hover:scale-[1.02] hover:shadow-xl"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-inner">
                  <feature.icon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-white text-lg">{feature.title}</h3>
                  <p className="text-sm text-white/70">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="w-full lg:w-[45%] flex flex-col bg-background relative overflow-hidden">
        {/* Mobile Hero Section */}
        <div className="lg:hidden bg-gradient-to-br from-masitcon-darkblue via-masitcon-lightblue to-masitcon-turquoise p-8 pb-16 relative overflow-hidden">
          {/* Mobile floating elements */}
          <FloatingBlob className="w-48 h-48 bg-masitcon-turquoise -top-10 -right-10" delay={0} />
          <FloatingBlob className="w-32 h-32 bg-white/20 bottom-0 -left-5" delay={1.5} />
          
          <div className="relative z-10 text-center">
            <img 
              src={masitconLogo} 
              alt="masitcon" 
              className="h-14 w-auto object-contain mx-auto brightness-0 invert drop-shadow-lg mb-4"
            />
            <h2 className="text-2xl font-bold text-white mb-2">Zeiterfassung</h2>
            <p className="text-white/80 text-sm font-light">Einfach. Präzise. Effizient.</p>
            
            {/* Mobile mini feature icons */}
            <div className="flex justify-center gap-4 mt-6">
              {features.map((feature, index) => (
                <div 
                  key={index}
                  className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center"
                >
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
              ))}
            </div>
          </div>
          
          {/* Wave transition to form area */}
          <svg 
            className="absolute -bottom-1 left-0 w-full h-8"
            viewBox="0 0 1440 48" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="none"
          >
            <path 
              d="M0,24 C360,48 720,0 1080,24 C1260,36 1380,48 1440,48 L1440,48 L0,48 Z" 
              className="fill-background"
            />
          </svg>
        </div>

        {/* Form area */}
        <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12">
          <Card className="w-full max-w-md border-0 shadow-none lg:border lg:shadow-lg lg:bg-card/80 lg:backdrop-blur-sm">
            {view === 'login' ? (
              <>
                <CardHeader className="space-y-1 text-center pb-2">
                  <CardTitle className="text-2xl font-bold text-foreground">Willkommen</CardTitle>
                  <CardDescription>Melden Sie sich mit Ihrem Konto an</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email">E-Mail</Label>
                      <Input
                        id="signin-email"
                        name="email"
                        type="email"
                        autoComplete="username"
                        placeholder="ihre.email@beispiel.de"
                        required
                        className="h-12"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="signin-password">Passwort</Label>
                      <Input
                        id="signin-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        className="h-12"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 text-base font-semibold bg-masitcon-turquoise hover:bg-masitcon-turquoise/90 shadow-lg shadow-masitcon-turquoise/25 transition-all duration-300 hover:shadow-xl hover:shadow-masitcon-turquoise/30"
                      disabled={loading}
                    >
                      {loading ? 'Wird angemeldet...' : 'Anmelden'}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      className="w-full text-sm text-muted-foreground hover:text-masitcon-turquoise"
                      onClick={() => { setView('forgot'); setForgotSent(false); setForgotEmail(''); }}
                    >
                      Passwort vergessen?
                    </Button>
                  </form>
                </CardContent>
              </>
            ) : (
              <>
                <CardHeader className="space-y-1 text-center pb-2">
                  <CardTitle className="text-2xl font-bold text-foreground">Passwort zurücksetzen</CardTitle>
                  <CardDescription>
                    {forgotSent
                      ? 'E-Mail versendet – bitte prüfen Sie Ihr Postfach.'
                      : 'Geben Sie Ihre E-Mail-Adresse ein. Sie erhalten einen Reset-Link.'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {forgotSent ? (
                    <div className="space-y-4">
                      <p className="text-sm text-center text-muted-foreground">
                        Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail gesendet.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full h-12"
                        onClick={() => { setView('login'); setForgotSent(false); setForgotEmail(''); }}
                      >
                        Zurück zur Anmeldung
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="forgot-email">E-Mail</Label>
                        <Input
                          id="forgot-email"
                          type="email"
                          autoComplete="username"
                          placeholder="ihre.email@beispiel.de"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          required
                          className="h-12"
                        />
                      </div>
                      <Button
                        type="submit"
                        className="w-full h-12 text-base font-semibold bg-masitcon-turquoise hover:bg-masitcon-turquoise/90"
                        disabled={loading}
                      >
                        {loading ? 'Wird gesendet...' : 'Reset-Link senden'}
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        className="w-full text-sm text-muted-foreground hover:text-masitcon-turquoise"
                        onClick={() => setView('login')}
                      >
                        Zurück zur Anmeldung
                      </Button>
                    </form>
                  )}
                </CardContent>
              </>
            )}
          </Card>

          <p className="mt-8 text-sm text-muted-foreground text-center">
            © {new Date().getFullYear()} masitcon. Alle Rechte vorbehalten.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
