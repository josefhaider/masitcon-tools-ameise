"use client";
import ReportDashboard from "@/components/reports/ReportDashboard";
import { useRouter } from "next/navigation";

export default function ReportingPage() {
  const router = useRouter();
  return <ReportDashboard onNavigate={(view: string) => {
    const routes: Record<string, string> = {
      'sick-leave-report': '/reporting/krankmeldungen',
      'hours-report': '/reporting/stunden',
      'balance-report': '/reporting/salden',
      'sick-leave-admin': '/genehmigungen/krankmeldungen',
    };
    router.push(routes[view] || '/reporting');
  }} />;
}
