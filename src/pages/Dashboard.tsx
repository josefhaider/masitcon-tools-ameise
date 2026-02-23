import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Clock } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import MonthlyTimeCalendar from '@/components/MonthlyTimeCalendar';
import AbsenceManager from '@/components/AbsenceManager';
import BreakRulesManager from '@/components/BreakRulesManager';
import YearlyVacationCalendar from '@/components/YearlyVacationCalendar';
import VacationManagement from '@/components/VacationManagement';
import VacationApprovalManager from '@/components/VacationApprovalManager';
import EmployeeManager from '@/components/EmployeeManager';
import { DashboardOverview } from '@/components/DashboardOverview';
import { TeamOverview } from '@/components/TeamOverview';
import { EmployeeDetailView } from '@/components/EmployeeDetailView';
import { UserProfile } from '@/components/UserProfile';
import AuditLogViewer from '@/components/AuditLogViewer';
import BalanceCorrectionManager from '@/components/BalanceCorrectionManager';
import TeamManager from '@/components/TeamManager';
import HolidayManager from '@/components/HolidayManager';
import SchoolHolidayManager from '@/components/SchoolHolidayManager';
import SickLeaveManagement from '@/components/SickLeaveManagement';
import ReportDashboard from '@/components/reports/ReportDashboard';
import SickLeaveAdminManager from '@/components/reports/SickLeaveAdminManager';
import SickLeaveReport from '@/components/reports/SickLeaveReport';
import MonthlyHoursReport from '@/components/reports/MonthlyHoursReport';
import BalanceReport from '@/components/reports/BalanceReport';
import Changelog from '@/components/Changelog';
import DataTransferManager from '@/components/DataTransferManager';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isApprover, setIsApprover] = useState(false);
  const [isHrManager, setIsHrManager] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [activeView, setActiveView] = useState('overview');
  const [selectedView, setSelectedView] = useState<'team' | 'employee'>('team');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) return;

      // Load profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      setProfile(profileData);

      // Check if user is admin or approver
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const roles = rolesData?.map(r => r.role) || [];
      setIsAdmin(roles.includes('admin'));
      setIsApprover(roles.includes('vacation_approver') || roles.includes('admin'));
      setIsHrManager(roles.includes('hr_manager') || roles.includes('admin'));
    };

    loadUserData();
  }, [user]);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast.error('Abmeldung fehlgeschlagen');
    } else {
      toast.success('Erfolgreich abgemeldet');
      navigate('/auth');
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Clock className="mx-auto h-12 w-12 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">Wird geladen...</p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider className="bg-gradient-to-br from-background to-muted">
      <AppSidebar
        isAdmin={isAdmin}
        isApprover={isApprover}
        isHrManager={isHrManager}
        activeView={activeView}
        onViewChange={setActiveView}
        onSignOut={handleSignOut}
        userName={profile?.full_name}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10 h-[53px]">
          <div className="container mx-auto flex items-center justify-between px-4 h-full">
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
                <Clock className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight">Zeiterfassung</h1>
                <p className="text-xs text-muted-foreground">
                  {profile?.full_name} {isAdmin && '(Admin)'}
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-full sm:max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-8 overflow-hidden">
          {activeView === 'overview' && <DashboardOverview userId={user.id} onNavigate={setActiveView} />}
          {activeView === 'calendar' && <MonthlyTimeCalendar userId={user.id} />}
          {activeView === 'vacation-request' && <VacationManagement />}
          {activeView === 'vacation-approval' && isApprover && <VacationApprovalManager />}
          {activeView === 'team-overview' && (isHrManager || isAdmin) && <TeamOverview />}
          {activeView === 'employees' && isAdmin && <EmployeeManager />}
          {activeView === 'vacation-planning' && <YearlyVacationCalendar />}
          {activeView === 'breaks' && isAdmin && <BreakRulesManager />}
          {activeView === 'absences' && (isHrManager || isAdmin) && <AbsenceManager />}
          {activeView === 'profile' && <UserProfile />}
          {activeView === 'audit-log' && isAdmin && <AuditLogViewer />}
          {activeView === 'corrections' && (isHrManager || isAdmin) && <BalanceCorrectionManager />}
          {activeView === 'teams' && isAdmin && <TeamManager />}
          {activeView === 'holidays' && isAdmin && <HolidayManager />}
          {activeView === 'school-holidays' && isAdmin && <SchoolHolidayManager />}
          {activeView === 'sick-leave' && <SickLeaveManagement />}
          {activeView === 'reports' && (isHrManager || isAdmin) && <ReportDashboard onNavigate={setActiveView} />}
          {activeView === 'sick-leave-admin' && (isHrManager || isAdmin) && <SickLeaveAdminManager />}
          {activeView === 'sick-leave-report' && (isHrManager || isAdmin) && <SickLeaveReport />}
          {activeView === 'hours-report' && (isHrManager || isAdmin) && <MonthlyHoursReport isAdmin={true} />}
          {activeView === 'balance-report' && (isHrManager || isAdmin) && <BalanceReport />}
          {activeView === 'data-transfer' && isAdmin && <DataTransferManager />}
          {activeView === 'changelog' && <Changelog />}
        </main>
      </div>
    </SidebarProvider>
  );
};

export default Dashboard;
