"use client";
import { DashboardOverview } from "@/components/DashboardOverview";
import { useProfile } from "@/contexts/profile-context";
import { useRouter } from "next/navigation";

export default function OverviewPage() {
  const { userId } = useProfile();
  const router = useRouter();
  return <DashboardOverview userId={userId} onNavigate={(view: string) => {
    const routes: Record<string, string> = {
      'calendar': '/zeiterfassung',
      'vacation-request': '/urlaub',
      'vacation-planning': '/urlaubsplanung',
      'sick-leave': '/krankmeldung',
      'vacation-approval': '/genehmigungen/urlaub',
      'team-overview': '/reporting/team',
      'reports': '/reporting',
      'employees': '/admin/mitarbeiter',
      'profile': '/profil',
      'overview': '/',
    };
    router.push(routes[view] || '/');
  }} />;
}
