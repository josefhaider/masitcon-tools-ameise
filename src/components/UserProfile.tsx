"use client";

import { useState, useEffect } from 'react';
import { useProfile } from '@/contexts/profile-context';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { User, Mail, Hash, Shield, Key, Save, Loader2, Clock, Eye, EyeOff } from 'lucide-react';
import { calculateWeeklyHoursFromSchedule } from '@/lib/weeklyHoursCalculator';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  employee_number: string | null;
}

interface UserRole {
  role: 'admin' | 'employee' | 'vacation_approver';
}

const roleLabels: Record<string, string> = {
  admin: 'Administrator',
  employee: 'Mitarbeiter',
  vacation_approver: 'Urlaubsgenehmiger',
};

const roleBadgeVariants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  admin: 'destructive',
  employee: 'secondary',
  vacation_approver: 'default',
};

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: '', color: '' };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score: 1, label: 'Schwach', color: 'bg-red-500' };
  if (score <= 2) return { score: 2, label: 'Mäßig', color: 'bg-orange-500' };
  if (score <= 3) return { score: 3, label: 'Gut', color: 'bg-yellow-500' };
  if (score <= 4) return { score: 4, label: 'Stark', color: 'bg-green-500' };
  return { score: 5, label: 'Sehr stark', color: 'bg-emerald-600' };
}

export function UserProfile() {
  const { userId } = useProfile();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [weeklyHours, setWeeklyHours] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const loadUserData = async () => {
      if (!userId) return;

      setLoading(true);
      
      // Load profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, employee_number')
        .eq('id', userId)
        .single();
      
      if (profileError) {
        toast.error('Profil konnte nicht geladen werden');
      } else if (profileData) {
        setProfile(profileData);
        setFullName(profileData.full_name);
      }

      // Load roles
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      
      setRoles((rolesData as UserRole[]) || []);
      
      // Calculate weekly hours from work schedule
      const hours = await calculateWeeklyHoursFromSchedule(userId);
      setWeeklyHours(hours);
      
      setLoading(false);
    };

    loadUserData();
  }, [userId]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !fullName.trim()) return;

    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', userId);

    if (error) {
      toast.error('Profil konnte nicht aktualisiert werden', {
        description: error.message,
      });
    } else {
      toast.success('Profil erfolgreich aktualisiert');
      setProfile(prev => prev ? { ...prev, full_name: fullName.trim() } : null);
    }
    setSaving(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast.error('Passwörter stimmen nicht überein');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('Passwort muss mindestens 8 Zeichen haben');
      return;
    }

    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      toast.error('Passwort konnte nicht geändert werden', {
        description: error.message,
      });
    } else {
      toast.success('Passwort erfolgreich geändert');
      setNewPassword('');
      setConfirmPassword('');
    }
    setChangingPassword(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Mein Profil</h2>
        <p className="text-muted-foreground">
          Verwalten Sie Ihre persönlichen Daten und Sicherheitseinstellungen.
        </p>
      </div>

      {/* Profile Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Persönliche Daten
          </CardTitle>
          <CardDescription>
            Ihre grundlegenden Profildaten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  E-Mail
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={profile?.email || ''}
                  disabled
                  className="bg-muted"
                />
                <p className="text-xs text-muted-foreground">
                  E-Mail kann nicht geändert werden.
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="fullName" className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Name
                </Label>
                <Input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  Mitarbeiternummer
                </Label>
                <Input
                  type="text"
                  value={profile?.employee_number || '-'}
                  disabled
                  className="bg-muted"
                />
              </div>
              
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Wochenstunden (aus Arbeitszeitprofil)
                </Label>
                <Input
                  type="text"
                  value={weeklyHours > 0 ? `${weeklyHours.toFixed(1).replace('.0', '')}h` : 'Nicht hinterlegt'}
                  disabled
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Wird gespeichert...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Speichern
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Roles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Rollen & Berechtigungen
          </CardTitle>
          <CardDescription>
            Ihre zugewiesenen Rollen im System.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {roles.length > 0 ? (
              roles.map((r, idx) => (
                <Badge key={idx} variant={roleBadgeVariants[r.role] || 'secondary'}>
                  {roleLabels[r.role] || r.role}
                </Badge>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">Keine Rollen zugewiesen.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card id="passwort">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Passwort ändern
          </CardTitle>
          <CardDescription>
            Ändern Sie Ihr Passwort für mehr Sicherheit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newPassword">Neues Passwort</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mindestens 8 Zeichen"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    tabIndex={-1}
                    aria-label={showNewPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {newPassword && (() => {
                  const strength = getPasswordStrength(newPassword);
                  return (
                    <div className="space-y-1">
                      <div className="flex h-1.5 gap-1">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <div
                            key={level}
                            className={`h-full flex-1 rounded-full transition-colors ${
                              level <= strength.score ? strength.color : 'bg-gray-200'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{strength.label}</p>
                    </div>
                  );
                })()}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Passwort bestätigen</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Passwort wiederholen"
                    minLength={8}
                    required
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600"
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && newPassword && confirmPassword !== newPassword && (
                  <p className="text-xs text-red-500">Passwörter stimmen nicht überein</p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="outline"
                disabled={changingPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword}
              >
                {changingPassword ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Wird geändert...
                  </>
                ) : (
                  <>
                    <Key className="mr-2 h-4 w-4" />
                    Passwort ändern
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
