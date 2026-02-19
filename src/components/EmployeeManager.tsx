import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, Pencil, UserPlus, X, ArrowLeft, Search, Clock, Coffee, Shield, Plus, Settings, Mail, KeyRound, Copy, Check, Eye, EyeOff, Archive, ArchiveRestore, Trash2, AlertTriangle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import WorkSchedulePeriods from "./WorkSchedulePeriods";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Profile {
  id: string;
  full_name: string;
  employee_number: string | null;
  time_tracking_exempt: boolean;
  is_archived?: boolean;
}

interface WorkSchedule {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  break_minutes: number;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}

interface SchedulePeriod {
  valid_from: string;
  valid_to: string | null;
  days: WorkSchedule[];
}

interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string;
  member_count?: number;
}

interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  teams: Team;
}

interface EmployeeOverview {
  id: string;
  full_name: string;
  employee_number: string | null;
  weekly_hours: number;
  daily_start: string | null;
  daily_end: string | null;
  break_minutes: number | null;
  schedule_type: 'einheitlich' | 'variabel' | 'nicht hinterlegt';
  time_tracking_exempt: boolean;
  is_archived: boolean;
}

interface UserRole {
  id: string;
  user_id: string;
  role: 'employee' | 'vacation_approver' | 'hr_manager' | 'admin';
}

const ROLE_LABELS: Record<string, { label: string; description: string }> = {
  employee: { label: 'Mitarbeiter', description: 'Standardrechte: Zeiterfassung, Urlaub beantragen, Krankmeldung' },
  vacation_approver: { label: 'Urlaubsgenehmiger', description: 'Kann Urlaubsanträge genehmigen/ablehnen' },
  hr_manager: { label: 'HR-Manager', description: 'Team-Übersicht, Reports, Krankmeldungen verwalten' },
  admin: { label: 'Administrator', description: 'Vollzugriff auf alle Funktionen' },
};

const EmployeeManager = () => {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [employeeOverviews, setEmployeeOverviews] = useState<EmployeeOverview[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [schedulePeriods, setSchedulePeriods] = useState<SchedulePeriod[]>([]);
  const [expandedPeriods, setExpandedPeriods] = useState<string[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [employeeTeams, setEmployeeTeams] = useState<TeamMember[]>([]);
  const [selectedTeamToAdd, setSelectedTeamToAdd] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [employeeRoles, setEmployeeRoles] = useState<UserRole[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);
  const [timeTrackingExempt, setTimeTrackingExempt] = useState(false);
  const [savingExempt, setSavingExempt] = useState(false);
  const [annualVacationDays, setAnnualVacationDays] = useState<number>(30);
  const [annualVacationDaysInput, setAnnualVacationDaysInput] = useState<string>("30");
  const [savingVacationDays, setSavingVacationDays] = useState(false);
  const [workDaysPerWeek, setWorkDaysPerWeek] = useState<number>(5);
  const [weeklyHours, setWeeklyHours] = useState<number>(40);
  const [newEmployeeForm, setNewEmployeeForm] = useState({
    full_name: "",
    email: "",
    password: "",
    employee_number: "",
  });
  const [creatingEmployee, setCreatingEmployee] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [editedName, setEditedName] = useState("");
  const [editedEmployeeNumber, setEditedEmployeeNumber] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  
  // Auth management states
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [editedEmail, setEditedEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  
  // Archive/Delete states
  const [showArchived, setShowArchived] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationCode, setDeleteConfirmationCode] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadEmployeeOverviews();
    loadTeams();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      loadSchedules();
      loadEmployeeTeams();
      loadEmployeeRoles();
      loadEmployeeExemptStatus();
      loadEmployeeVacationDays();
      loadEmployeeEmail();
      // Reset auth states
      setNewPassword("");
      setResetLink(null);
      setCopiedLink(false);
    }
  }, [selectedUserId]);

  const loadEmployeeOverviews = async () => {
    setLoading(true);
    const today = format(new Date(), 'yyyy-MM-dd');
    
    try {
      // Load all profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, employee_number, time_tracking_exempt, is_archived')
        .order('full_name');

      if (profilesError) throw profilesError;

      // Load only currently valid work schedules (valid_from <= today AND (valid_to is null OR valid_to >= today))
      const { data: schedulesData, error: schedulesError } = await supabase
        .from('employee_work_schedules')
        .select('user_id, start_time, end_time, break_minutes, day_of_week')
        .eq('is_active', true)
        .lte('valid_from', today)
        .or(`valid_to.is.null,valid_to.gte.${today}`);

      if (schedulesError) throw schedulesError;

      // Group schedules by user
      const schedulesByUser = new Map<string, typeof schedulesData>();
      (schedulesData || []).forEach(schedule => {
        const existing = schedulesByUser.get(schedule.user_id) || [];
        existing.push(schedule);
        schedulesByUser.set(schedule.user_id, existing);
      });

      // Build overview data with calculated weekly hours
      const overviews: EmployeeOverview[] = (profilesData || []).map(profile => {
        const userSchedules = schedulesByUser.get(profile.id) || [];
        
        // Calculate weekly hours from schedules
        const weeklyHours = userSchedules.reduce((total, s) => {
          const startParts = s.start_time.split(':').map(Number);
          const endParts = s.end_time.split(':').map(Number);
          const startMinutes = startParts[0] * 60 + startParts[1];
          const endMinutes = endParts[0] * 60 + endParts[1];
          const workMinutes = endMinutes - startMinutes - s.break_minutes;
          return total + Math.max(0, workMinutes / 60);
        }, 0);
        
        if (userSchedules.length === 0) {
          return {
            ...profile,
            weekly_hours: 0,
            daily_start: null,
            daily_end: null,
            break_minutes: null,
            schedule_type: 'nicht hinterlegt' as const,
            time_tracking_exempt: profile.time_tracking_exempt || false,
            is_archived: profile.is_archived || false,
          };
        }

        // Check if all schedules have the same times
        const firstSchedule = userSchedules[0];
        const allSame = userSchedules.every(
          s => s.start_time === firstSchedule.start_time && 
               s.end_time === firstSchedule.end_time &&
               s.break_minutes === firstSchedule.break_minutes
        );

        if (allSame) {
          return {
            ...profile,
            weekly_hours: weeklyHours,
            daily_start: firstSchedule.start_time.slice(0, 5),
            daily_end: firstSchedule.end_time.slice(0, 5),
            break_minutes: firstSchedule.break_minutes,
            schedule_type: 'einheitlich' as const,
            time_tracking_exempt: profile.time_tracking_exempt || false,
            is_archived: profile.is_archived || false,
          };
        }

        // Calculate average/most common values for variable schedules
        const avgBreak = Math.round(
          userSchedules.reduce((sum, s) => sum + s.break_minutes, 0) / userSchedules.length
        );

        return {
          ...profile,
          weekly_hours: weeklyHours,
          daily_start: null,
          daily_end: null,
          break_minutes: avgBreak,
          schedule_type: 'variabel' as const,
          time_tracking_exempt: profile.time_tracking_exempt || false,
          is_archived: profile.is_archived || false,
        };
      });

      setProfiles(profilesData || []);
      setEmployeeOverviews(overviews);
    } catch (error: any) {
      toast.error("Mitarbeiter konnten nicht geladen werden: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSchedules = async () => {
    if (!selectedUserId) return;

    const { data } = await supabase
      .from('employee_work_schedules')
      .select('*')
      .eq('user_id', selectedUserId)
      .order('valid_from', { ascending: false });

    const allSchedules = data || [];
    setSchedules(allSchedules);

    // Group schedules by period
    const periodMap = new Map<string, WorkSchedule[]>();
    allSchedules.forEach(schedule => {
      const periodKey = `${schedule.valid_from}_${schedule.valid_to || 'unbefristet'}`;
      if (!periodMap.has(periodKey)) {
        periodMap.set(periodKey, []);
      }
      periodMap.get(periodKey)!.push(schedule);
    });

    const periods: SchedulePeriod[] = [];
    periodMap.forEach((days, key) => {
      const firstDay = days[0];
      periods.push({
        valid_from: firstDay.valid_from,
        valid_to: firstDay.valid_to,
        days: days.sort((a, b) => {
          const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Mo-So
          return dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week);
        }),
      });
    });

    setSchedulePeriods(periods);
    
    // Expand first period by default
    if (periods.length > 0 && expandedPeriods.length === 0) {
      setExpandedPeriods([`${periods[0].valid_from}_${periods[0].valid_to || 'unbefristet'}`]);
    }
  };

  const loadTeams = async () => {
    try {
      const { data: teamsData, error: teamsError } = await supabase
        .from("teams")
        .select("*")
        .order("name");

      if (teamsError) throw teamsError;

      const teamsWithCounts = await Promise.all(
        (teamsData || []).map(async (team) => {
          const { count } = await supabase
            .from("team_members")
            .select("*", { count: "exact", head: true })
            .eq("team_id", team.id)
            .eq("is_active", true);

          return { ...team, member_count: count || 0 };
        })
      );

      setTeams(teamsWithCounts);
    } catch (error: any) {
      toast.error("Teams konnten nicht geladen werden: " + error.message);
    }
  };

  const loadEmployeeTeams = async () => {
    if (!selectedUserId) return;

    const { data } = await supabase
      .from('team_members')
      .select(`
        id,
        team_id,
        user_id,
        teams(id, name, color)
      `)
      .eq('user_id', selectedUserId)
      .eq('is_active', true);

    setEmployeeTeams((data || []).filter(tm => tm.teams) as TeamMember[]);
  };

  const loadEmployeeRoles = async () => {
    if (!selectedUserId) return;

    const { data } = await supabase
      .from('user_roles')
      .select('id, user_id, role')
      .eq('user_id', selectedUserId);

    setEmployeeRoles((data || []) as UserRole[]);
  };

  const loadEmployeeExemptStatus = async () => {
    if (!selectedUserId) return;

    const { data } = await supabase
      .from('profiles')
      .select('time_tracking_exempt, full_name, employee_number, is_archived')
      .eq('id', selectedUserId)
      .single();

    setTimeTrackingExempt(data?.time_tracking_exempt || false);
    setEditedName(data?.full_name || "");
    setEditedEmployeeNumber(data?.employee_number || "");
    setIsArchived(data?.is_archived || false);
  };

  const loadEmployeeEmail = async () => {
    if (!selectedUserId) return;

    const { data } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', selectedUserId)
      .single();

    const email = data?.email || "";
    setEmployeeEmail(email);
    setEditedEmail(email);
  };

  const loadEmployeeVacationDays = async () => {
    if (!selectedUserId) return;

    const today = format(new Date(), 'yyyy-MM-dd');

    // Load vacation days from profile
    const { data: profileData } = await supabase
      .from('profiles')
      .select('annual_vacation_days')
      .eq('id', selectedUserId)
      .single();

    const vacationDays = profileData?.annual_vacation_days ?? 30;
    setAnnualVacationDays(vacationDays);
    setAnnualVacationDaysInput(String(vacationDays));

    // Load current work schedules to calculate work days per week and weekly hours
    const { data: schedulesData } = await supabase
      .from('employee_work_schedules')
      .select('day_of_week, start_time, end_time, break_minutes')
      .eq('user_id', selectedUserId)
      .eq('is_active', true)
      .lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`);

    if (schedulesData && schedulesData.length > 0) {
      // Count unique work days
      const uniqueDays = new Set(schedulesData.map(s => s.day_of_week));
      setWorkDaysPerWeek(uniqueDays.size);

      // Calculate weekly hours
      const totalWeeklyHours = schedulesData.reduce((total, s) => {
        const startParts = s.start_time.split(':').map(Number);
        const endParts = s.end_time.split(':').map(Number);
        const startMinutes = startParts[0] * 60 + startParts[1];
        const endMinutes = endParts[0] * 60 + endParts[1];
        const workMinutes = endMinutes - startMinutes - s.break_minutes;
        return total + Math.max(0, workMinutes / 60);
      }, 0);
      setWeeklyHours(totalWeeklyHours);
    } else {
      setWorkDaysPerWeek(5);
      setWeeklyHours(40);
    }
  };

  const handleUpdateEmail = async () => {
    if (!selectedUserId || !editedEmail.trim() || !editedEmail.includes('@')) {
      toast.error("Bitte geben Sie eine gültige E-Mail-Adresse ein");
      return;
    }

    if (editedEmail === employeeEmail) {
      return;
    }

    setSavingEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: {
          action: 'update_email',
          target_user_id: selectedUserId,
          new_email: editedEmail.trim(),
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setEmployeeEmail(editedEmail.trim());
      toast.success('E-Mail-Adresse aktualisiert');
    } catch (error: any) {
      console.error('Error updating email:', error);
      toast.error(error.message || "E-Mail konnte nicht geändert werden");
    } finally {
      setSavingEmail(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUserId || !newPassword || newPassword.length < 6) {
      toast.error("Passwort muss mindestens 6 Zeichen haben");
      return;
    }

    setResettingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: {
          action: 'reset_password',
          target_user_id: selectedUserId,
          new_password: newPassword,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setNewPassword("");
      toast.success('Passwort wurde zurückgesetzt');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      toast.error(error.message || "Passwort konnte nicht zurückgesetzt werden");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleGenerateResetLink = async () => {
    if (!selectedUserId) return;

    setResettingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: {
          action: 'send_password_reset',
          target_user_id: selectedUserId,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (data?.reset_link) {
        setResetLink(data.reset_link);
        toast.success('Passwort-Reset-Link generiert');
      }
    } catch (error: any) {
      console.error('Error generating reset link:', error);
      toast.error(error.message || "Reset-Link konnte nicht generiert werden");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleCopyResetLink = async () => {
    if (!resetLink) return;
    
    try {
      // Primärer Versuch: Moderne Clipboard API (erfordert HTTPS)
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(resetLink);
      } else {
        // Fallback für HTTP oder ältere Browser
        const textArea = document.createElement('textarea');
        textArea.value = resetLink;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) {
          throw new Error('execCommand failed');
        }
      }
      setCopiedLink(true);
      toast.success('Link in Zwischenablage kopiert');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      // Fallback: Text zur manuellen Auswahl anbieten
      toast.info('Bitte manuell kopieren (Strg+C / Cmd+C)', {
        description: 'Der Link wurde ausgewählt.',
      });
    }
  };

  const handleArchiveEmployee = async () => {
    if (!selectedUserId) return;

    setArchiving(true);
    try {
      const action = isArchived ? 'unarchive_user' : 'archive_user';
      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: {
          action,
          target_user_id: selectedUserId,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setIsArchived(!isArchived);
      toast.success(isArchived ? 'Mitarbeiter reaktiviert' : 'Mitarbeiter archiviert');
      loadEmployeeOverviews();
    } catch (error: any) {
      console.error('Error archiving employee:', error);
      toast.error(error.message || "Aktion konnte nicht ausgeführt werden");
    } finally {
      setArchiving(false);
    }
  };

  const handleDeleteEmployee = async () => {
    if (!selectedUserId || !selectedEmployee) return;

    const expectedCode = `LÖSCHEN-${selectedEmployee.full_name}`;
    if (deleteConfirmationCode !== expectedCode) {
      toast.error("Bestätigungscode stimmt nicht überein");
      return;
    }

    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-update-user', {
        body: {
          action: 'delete_user',
          target_user_id: selectedUserId,
          confirmation_code: deleteConfirmationCode,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      toast.success(data.message || 'Mitarbeiter wurde gelöscht');
      setDeleteDialogOpen(false);
      setDeleteConfirmationCode("");
      handleBackToOverview();
    } catch (error: any) {
      console.error('Error deleting employee:', error);
      toast.error(error.message || "Mitarbeiter konnte nicht gelöscht werden");
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdateVacationDays = async () => {
    if (!selectedUserId) return;

    const newValue = parseFloat(annualVacationDaysInput);
    if (isNaN(newValue) || newValue < 0 || newValue > 365) {
      toast.error("Bitte geben Sie einen gültigen Wert zwischen 0 und 365 ein");
      return;
    }

    setSavingVacationDays(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ annual_vacation_days: newValue })
        .eq('id', selectedUserId);

      if (error) throw error;

      setAnnualVacationDays(newValue);
      toast.success('Urlaubstage aktualisiert');
    } catch (error: any) {
      toast.error("Urlaubstage konnten nicht gespeichert werden: " + error.message);
    } finally {
      setSavingVacationDays(false);
    }
  };

  const handleUpdateProfile = async () => {
    if (!selectedUserId || !editedName.trim()) {
      toast.error("Der Name darf nicht leer sein");
      return;
    }

    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          full_name: editedName.trim(),
          employee_number: editedEmployeeNumber.trim() || null
        })
        .eq('id', selectedUserId);

      if (error) throw error;

      toast.success('Profil aktualisiert');
      loadEmployeeOverviews();
    } catch (error: any) {
      toast.error("Profil konnte nicht gespeichert werden: " + error.message);
    } finally {
      setSavingProfile(false);
    }
  };

  // Calculate hours per vacation day
  const hoursPerVacationDay = useMemo(() => {
    if (workDaysPerWeek === 0) return 0;
    return weeklyHours / workDaysPerWeek;
  }, [weeklyHours, workDaysPerWeek]);

  const handleToggleTimeTrackingExempt = async (checked: boolean) => {
    if (!selectedUserId) return;
    
    setSavingExempt(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ time_tracking_exempt: checked })
        .eq('id', selectedUserId);
      
      if (error) throw error;
      
      setTimeTrackingExempt(checked);
      toast.success(checked ? 'Zeiterfassung deaktiviert' : 'Zeiterfassung aktiviert');
      loadEmployeeOverviews();
    } catch (error: any) {
      toast.error("Einstellung konnte nicht geändert werden: " + error.message);
    } finally {
      setSavingExempt(false);
    }
  };

  const handleToggleRole = async (role: 'employee' | 'vacation_approver' | 'hr_manager' | 'admin') => {
    if (!selectedUserId) return;
    
    setSavingRoles(true);
    try {
      const existingRole = employeeRoles.find(r => r.role === role);
      
      if (existingRole) {
        // Remove role
        const { error } = await supabase
          .from('user_roles')
          .delete()
          .eq('id', existingRole.id);
        
        if (error) throw error;
        toast.success(`Rolle "${ROLE_LABELS[role].label}" entfernt`);
      } else {
        // Add role
        const { error } = await supabase
          .from('user_roles')
          .insert({
            user_id: selectedUserId,
            role: role,
          });
        
        if (error) throw error;
        toast.success(`Rolle "${ROLE_LABELS[role].label}" hinzugefügt`);
      }
      
      await loadEmployeeRoles();
    } catch (error: any) {
      toast.error("Rolle konnte nicht geändert werden: " + error.message);
    } finally {
      setSavingRoles(false);
    }
  };

  const handleAddTeamToEmployee = async () => {
    if (!selectedUserId || !selectedTeamToAdd) {
      toast.error("Bitte wählen Sie ein Team aus");
      return;
    }

    try {
      const { error } = await supabase.from("team_members").insert({
        team_id: selectedTeamToAdd,
        user_id: selectedUserId,
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("Dieser Mitarbeiter ist bereits in diesem Team");
        } else {
          throw error;
        }
        return;
      }

      toast.success("Team hinzugefügt");
      setSelectedTeamToAdd("");
      loadEmployeeTeams();
      loadTeams();
    } catch (error: any) {
      toast.error("Fehler beim Hinzufügen: " + error.message);
    }
  };

  const handleRemoveTeamFromEmployee = async (membershipId: string) => {
    try {
      const { error } = await supabase
        .from("team_members")
        .delete()
        .eq("id", membershipId);

      if (error) throw error;

      toast.success("Team entfernt");
      loadEmployeeTeams();
      loadTeams();
    } catch (error: any) {
      toast.error("Fehler beim Entfernen: " + error.message);
    }
  };


  const handleCreateEmployee = async () => {
    const { full_name, email, password, employee_number } = newEmployeeForm;

    // Validation
    if (!full_name.trim() || !email.trim() || !password.trim()) {
      toast.error("Name, E-Mail und Passwort sind erforderlich");
      return;
    }

    if (password.length < 6) {
      toast.error("Passwort muss mindestens 6 Zeichen haben");
      return;
    }

    setCreatingEmployee(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-employee', {
        body: {
          full_name: full_name.trim(),
          email: email.trim(),
          password: password,
          employee_number: employee_number.trim() || undefined,
        },
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      toast.success("Mitarbeiter wurde erfolgreich angelegt");
      
      // Reset form
      setNewEmployeeForm({
        full_name: "",
        email: "",
        password: "",
        employee_number: "",
      });
      
      setCreateDialogOpen(false);
      
      // Reload employee overviews
      await loadEmployeeOverviews();
      
      if (data?.user_id) {
        setSelectedUserId(data.user_id);
      }
    } catch (error: any) {
      console.error('Error creating employee:', error);
      toast.error(error.message || "Fehler beim Anlegen des Mitarbeiters");
    } finally {
      setCreatingEmployee(false);
    }
  };

  const handleBackToOverview = () => {
    setSelectedUserId("");
    setSchedulePeriods([]);
    setExpandedPeriods([]);
    setEmployeeTeams([]);
    loadEmployeeOverviews();
  };

  const handleEditEmployee = (employeeId: string) => {
    setSelectedUserId(employeeId);
  };

  // Filter employees based on search query and archive status
  const filteredEmployees = useMemo(() => {
    let employees = employeeOverviews;
    
    // Filter by archive status
    if (!showArchived) {
      employees = employees.filter(emp => !emp.is_archived);
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      employees = employees.filter(emp => 
        emp.full_name.toLowerCase().includes(query) ||
        (emp.employee_number && emp.employee_number.toLowerCase().includes(query))
      );
    }
    
    return employees;
  }, [employeeOverviews, searchQuery, showArchived]);

  const archivedCount = useMemo(() => 
    employeeOverviews.filter(emp => emp.is_archived).length,
  [employeeOverviews]);

  const selectedEmployee = employeeOverviews.find(p => p.id === selectedUserId);

  // Helper function to format time display
  const formatTimeDisplay = (emp: EmployeeOverview) => {
    if (emp.schedule_type === 'nicht hinterlegt') {
      return <Badge variant="outline" className="text-muted-foreground">nicht hinterlegt</Badge>;
    }
    if (emp.schedule_type === 'variabel') {
      return <Badge variant="secondary">variabel</Badge>;
    }
    return `${emp.daily_start} - ${emp.daily_end}`;
  };

  const formatBreakDisplay = (emp: EmployeeOverview) => {
    if (emp.break_minutes === null) {
      return <span className="text-muted-foreground">-</span>;
    }
    return `${emp.break_minutes} Min`;
  };

  return (
    <Card className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h2 className="text-2xl font-bold">Mitarbeiter-Verwaltung</h2>
      </div>

      {selectedUserId ? (
        // Detail View
        <div className="space-y-4">
          <div className="flex items-center gap-4 mb-6">
            <Button variant="outline" onClick={handleBackToOverview}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Zurück zur Übersicht
            </Button>
            <div className="flex-1">
              <h3 className="text-lg font-semibold">
                {selectedEmployee?.full_name}
                {selectedEmployee?.employee_number && (
                  <span className="text-muted-foreground font-normal ml-2">
                    ({selectedEmployee.employee_number})
                  </span>
                )}
              </h3>
            </div>
          </div>

          <Tabs defaultValue="schedule" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="schedule">Arbeitszeiten</TabsTrigger>
              <TabsTrigger value="settings">Einstellungen</TabsTrigger>
              <TabsTrigger value="roles">Rollen</TabsTrigger>
              <TabsTrigger value="teams">Team-Zuordnung</TabsTrigger>
            </TabsList>

            <TabsContent value="settings" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Settings className="h-5 w-5" />
                    Mitarbeiter-Einstellungen
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Stammdaten */}
                  <div>
                    <h4 className="font-medium mb-4">Stammdaten</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="employee-name">Name</Label>
                        <Input
                          id="employee-name"
                          value={editedName}
                          onChange={(e) => setEditedName(e.target.value)}
                          placeholder="Vollständiger Name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="employee-number">Mitarbeiternummer</Label>
                        <Input
                          id="employee-number"
                          value={editedEmployeeNumber}
                          onChange={(e) => setEditedEmployeeNumber(e.target.value)}
                          placeholder="z.B. MA001"
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <Button 
                        onClick={handleUpdateProfile}
                        disabled={savingProfile || !editedName.trim()}
                        size="sm"
                      >
                        {savingProfile ? 'Speichern...' : 'Stammdaten speichern'}
                      </Button>
                    </div>
                  </div>

                  {/* E-Mail-Adresse & Zugangsdaten */}
                  <div className="border-t pt-6">
                    <h4 className="font-medium mb-4 flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Zugangsdaten
                    </h4>
                    <div className="space-y-4">
                      {/* Email ändern */}
                      <div className="space-y-2">
                        <Label htmlFor="employee-email">E-Mail-Adresse</Label>
                        <div className="flex gap-2">
                          <Input
                            id="employee-email"
                            type="email"
                            value={editedEmail}
                            onChange={(e) => setEditedEmail(e.target.value)}
                            placeholder="email@example.com"
                            className="flex-1"
                          />
                          <Button 
                            onClick={handleUpdateEmail}
                            disabled={savingEmail || editedEmail === employeeEmail || !editedEmail.includes('@')}
                            size="sm"
                          >
                            {savingEmail ? 'Speichern...' : 'Speichern'}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Ändert die Login-E-Mail-Adresse des Mitarbeiters.
                        </p>
                      </div>

                      {/* Passwort zurücksetzen */}
                      <div className="space-y-3 mt-4">
                        <Label className="flex items-center gap-2">
                          <KeyRound className="h-4 w-4" />
                          Passwort zurücksetzen
                        </Label>
                        
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              type={showNewPassword ? "text" : "password"}
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              placeholder="Neues Passwort (min. 6 Zeichen)"
                              autoComplete="new-password"
                              minLength={6}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                            >
                              {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </Button>
                          </div>
                          <Button 
                            onClick={handleResetPassword}
                            disabled={resettingPassword || newPassword.length < 6}
                            size="sm"
                          >
                            {resettingPassword ? 'Setze...' : 'Setzen'}
                          </Button>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">oder</span>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={handleGenerateResetLink}
                            disabled={resettingPassword}
                          >
                            <KeyRound className="h-4 w-4 mr-2" />
                            Reset-Link generieren
                          </Button>
                        </div>

                        {resetLink && (
                          <div className="p-3 bg-muted/50 rounded-lg space-y-2">
                            <p className="text-sm font-medium">Passwort-Reset-Link:</p>
                            <div className="flex gap-2">
                              <Input 
                                value={resetLink} 
                                readOnly 
                                className="text-xs font-mono"
                              />
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={handleCopyResetLink}
                              >
                                {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Dieser Link kann dem Mitarbeiter zugesendet werden. Der Link ist zeitlich begrenzt gültig.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <h4 className="font-medium mb-4">Zeiterfassung</h4>
                  </div>
                  {/* Zeiterfassung */}
                  <div>
                    <div
                      className={`flex items-start justify-between p-4 border rounded-lg transition-colors ${
                        timeTrackingExempt ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700' : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id="time-tracking-exempt"
                          checked={timeTrackingExempt}
                          onCheckedChange={(checked) => handleToggleTimeTrackingExempt(checked === true)}
                          disabled={savingExempt}
                          className="mt-1"
                        />
                        <div>
                          <label htmlFor="time-tracking-exempt" className="font-medium cursor-pointer">
                            Keine Zeiterfassung (z.B. Führungskraft)
                          </label>
                          <p className="text-sm text-muted-foreground mt-1">
                            Wenn aktiviert, wird für diesen Mitarbeiter keine Zeiterfassung erwartet. 
                            Der Mitarbeiter erscheint weiterhin in der Urlaubsplanung, aber nicht in Stundenauswertungen.
                          </p>
                          {timeTrackingExempt && (
                            <Badge variant="secondary" className="mt-2 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                              Zeiterfassung deaktiviert
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Urlaubsanspruch */}
                  <div className="border-t pt-6">
                    <h4 className="font-medium mb-4">Urlaubsanspruch</h4>
                    <div className="space-y-4">
                      <div className="flex items-end gap-3">
                        <div className="space-y-2">
                          <Label htmlFor="annual-vacation-days">Jahresurlaub (Tage)</Label>
                          <Input
                            id="annual-vacation-days"
                            type="number"
                            min="0"
                            max="365"
                            step="0.5"
                            value={annualVacationDaysInput}
                            onChange={(e) => setAnnualVacationDaysInput(e.target.value)}
                            className="w-24"
                          />
                        </div>
                        <Button 
                          onClick={handleUpdateVacationDays}
                          disabled={savingVacationDays || annualVacationDaysInput === String(annualVacationDays)}
                          size="sm"
                        >
                          {savingVacationDays ? 'Speichern...' : 'Speichern'}
                        </Button>
                      </div>
                      
                      <div className="p-4 bg-muted/50 rounded-lg">
                        <div className="text-sm font-medium">
                          Stundenwert pro Urlaubstag: <span className="text-primary">{hoursPerVacationDay.toFixed(1).replace('.0', '')} Stunden</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Berechnet aus: {weeklyHours.toFixed(1).replace('.0', '')} Wochenstunden / {workDaysPerWeek} Arbeitstage
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Mitarbeiterstatus */}
                  <div className="border-t pt-6">
                    <h4 className="font-medium mb-4 flex items-center gap-2">
                      {isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                      Mitarbeiterstatus
                    </h4>
                    <div className="space-y-4">
                      {/* Archive status */}
                      <div className={`p-4 border rounded-lg ${isArchived ? 'bg-muted/50 border-muted' : 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              {isArchived ? (
                                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                                  <Archive className="h-3 w-3 mr-1" />
                                  Archiviert
                                </Badge>
                              ) : (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                  Aktiv
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-2">
                              {isArchived 
                                ? "Der Mitarbeiter ist deaktiviert und kann sich nicht mehr anmelden." 
                                : "Der Mitarbeiter ist aktiv und hat Zugang zum System."}
                            </p>
                          </div>
                          <Button
                            variant={isArchived ? "default" : "outline"}
                            onClick={handleArchiveEmployee}
                            disabled={archiving}
                          >
                            {archiving ? (
                              "..."
                            ) : isArchived ? (
                              <>
                                <ArchiveRestore className="h-4 w-4 mr-2" />
                                Reaktivieren
                              </>
                            ) : (
                              <>
                                <Archive className="h-4 w-4 mr-2" />
                                Archivieren
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Permanent delete */}
                      <div className="p-4 border border-destructive/30 rounded-lg bg-destructive/5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-medium text-destructive flex items-center gap-2">
                              <Trash2 className="h-4 w-4" />
                              Mitarbeiter dauerhaft löschen
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Löscht den Mitarbeiter und <strong>alle zugehörigen Daten</strong> (Zeiteinträge, Urlaube, Krankmeldungen, etc.) unwiderruflich.
                            </p>
                          </div>
                          <Button
                            variant="destructive"
                            onClick={() => setDeleteDialogOpen(true)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Löschen
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="roles" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="h-5 w-5" />
                    Benutzerrollen verwalten
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {(['employee', 'vacation_approver', 'hr_manager', 'admin'] as const).map((role) => {
                      const hasRole = employeeRoles.some(r => r.role === role);
                      const roleInfo = ROLE_LABELS[role];
                      return (
                        <div
                          key={role}
                          className={`flex items-start justify-between p-4 border rounded-lg transition-colors ${
                            hasRole ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted/50'
                          }`}
                        >
                          <div className="flex-1">
                            <div className="font-medium flex items-center gap-2">
                              {roleInfo.label}
                              {hasRole && (
                                <Badge variant="secondary" className="text-xs">Aktiv</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {roleInfo.description}
                            </p>
                          </div>
                          <Button
                            variant={hasRole ? "destructive" : "default"}
                            size="sm"
                            onClick={() => handleToggleRole(role)}
                            disabled={savingRoles}
                          >
                            {hasRole ? 'Entfernen' : 'Hinzufügen'}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground mt-4">
                    Ein Mitarbeiter kann mehrere Rollen gleichzeitig haben. 
                    Die Berechtigungen werden kombiniert.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="schedule" className="mt-6">
              <WorkSchedulePeriods 
                userId={selectedUserId} 
                periods={schedulePeriods}
                onUpdate={loadSchedules}
              />
            </TabsContent>

            <TabsContent value="teams" className="mt-6">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <UserPlus className="h-5 w-5" />
                      Team hinzufügen
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2">
                      <Select value={selectedTeamToAdd} onValueChange={setSelectedTeamToAdd}>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Team wählen..." />
                        </SelectTrigger>
                        <SelectContent>
                          {teams.map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-3 h-3 rounded-full"
                                  style={{ backgroundColor: team.color }}
                                />
                                {team.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleAddTeamToEmployee} disabled={!selectedTeamToAdd}>
                        Hinzufügen
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Aktuelle Teams</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {employeeTeams.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {employeeTeams.map((tm) => (
                          <Badge
                            key={tm.id}
                            variant="secondary"
                            className="gap-2 text-base py-2 px-3"
                            style={{
                              borderLeft: `3px solid ${tm.teams.color}`,
                            }}
                          >
                            {tm.teams.name}
                            <button
                              onClick={() => handleRemoveTeamFromEmployee(tm.id)}
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">Kein Team zugeordnet</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

          </Tabs>
        </div>
      ) : (
        // Overview Table
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Button 
              onClick={() => setCreateDialogOpen(true)}
              className="sm:w-auto"
            >
              <Plus className="h-4 w-4 mr-2" />
              Neuen Mitarbeiter anlegen
            </Button>
            
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Nach Name oder Mitarbeiternummer suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {archivedCount > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-archived"
                  checked={showArchived}
                  onCheckedChange={(checked) => setShowArchived(checked === true)}
                />
                <label htmlFor="show-archived" className="text-sm text-muted-foreground cursor-pointer">
                  Archivierte anzeigen ({archivedCount})
                </label>
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              Lade Mitarbeiter...
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchQuery ? "Keine Mitarbeiter gefunden" : "Noch keine Mitarbeiter vorhanden"}
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Name</TableHead>
                    <TableHead className="font-semibold">MA-Nr.</TableHead>
                    <TableHead className="font-semibold">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        Wochenstunden
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold">Tagesarbeitszeit</TableHead>
                    <TableHead className="font-semibold">
                      <div className="flex items-center gap-1">
                        <Coffee className="h-4 w-4" />
                        Pause/Tag
                      </div>
                    </TableHead>
                    <TableHead className="font-semibold text-right">Aktionen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => (
                    <TableRow key={emp.id} className={`hover:bg-muted/30 transition-colors ${emp.is_archived ? 'opacity-60' : ''}`}>
                      <TableCell className="font-medium">
                        <span className={emp.is_archived ? 'line-through' : ''}>
                          {emp.full_name}
                        </span>
                        {emp.is_archived && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            <Archive className="h-3 w-3 mr-1" />
                            Archiviert
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {emp.employee_number || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell>
                        {emp.weekly_hours > 0 ? (
                          `${emp.weekly_hours.toFixed(1).replace('.0', '')}h`
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{formatTimeDisplay(emp)}</TableCell>
                      <TableCell>{formatBreakDisplay(emp)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditEmployee(emp.id)}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Bearbeiten
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="text-sm text-muted-foreground">
            {filteredEmployees.length} von {employeeOverviews.length} Mitarbeiter
          </div>
        </div>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Neuen Mitarbeiter anlegen</DialogTitle>
            <DialogDescription>
              Erstellen Sie einen neuen Mitarbeiter mit Login-Zugang.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-name">Name *</Label>
              <Input
                id="new-name"
                value={newEmployeeForm.full_name}
                onChange={(e) =>
                  setNewEmployeeForm({ ...newEmployeeForm, full_name: e.target.value })
                }
                placeholder="Max Mustermann"
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-email">E-Mail * (für Login)</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="off"
                value={newEmployeeForm.email}
                onChange={(e) =>
                  setNewEmployeeForm({ ...newEmployeeForm, email: e.target.value })
                }
                placeholder="max@example.com"
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Passwort * (mind. 6 Zeichen)</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newEmployeeForm.password}
                onChange={(e) =>
                  setNewEmployeeForm({ ...newEmployeeForm, password: e.target.value })
                }
                placeholder="••••••"
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-employee-number">Mitarbeiternummer (optional)</Label>
              <Input
                id="new-employee-number"
                value={newEmployeeForm.employee_number}
                onChange={(e) =>
                  setNewEmployeeForm({ ...newEmployeeForm, employee_number: e.target.value })
                }
                placeholder="MA001"
                maxLength={50}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={creatingEmployee}
            >
              Abbrechen
            </Button>
            <Button onClick={handleCreateEmployee} disabled={creatingEmployee}>
              {creatingEmployee ? "Wird erstellt..." : "Mitarbeiter erstellen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) {
          setDeleteConfirmationCode("");
        }
      }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Mitarbeiter dauerhaft löschen?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  Sie sind dabei, den Mitarbeiter <strong>"{selectedEmployee?.full_name}"</strong> dauerhaft zu löschen.
                </p>
                
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm">
                  <p className="font-semibold text-destructive mb-2">DIES LÖSCHT UNWIDERRUFLICH:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>Alle Zeiteinträge</li>
                    <li>Alle Urlaubsanträge und Krankmeldungen</li>
                    <li>Alle Arbeitszeitprofile</li>
                    <li>Alle Team-Zuordnungen</li>
                    <li>Alle Saldo-Korrekturen</li>
                    <li>Den Benutzer-Account</li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="delete-confirmation">
                    Um fortzufahren, geben Sie ein: <br />
                    <code className="bg-muted px-2 py-1 rounded text-sm font-mono">LÖSCHEN-{selectedEmployee?.full_name}</code>
                  </Label>
                  <Input
                    id="delete-confirmation"
                    value={deleteConfirmationCode}
                    onChange={(e) => setDeleteConfirmationCode(e.target.value)}
                    placeholder="Bestätigungscode eingeben..."
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Abbrechen</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDeleteEmployee}
              disabled={deleting || deleteConfirmationCode !== `LÖSCHEN-${selectedEmployee?.full_name}`}
            >
              {deleting ? "Wird gelöscht..." : "Endgültig löschen"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default EmployeeManager;
