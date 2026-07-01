"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/contexts/permissions-context";

export type PendingApprovalCounts = {
  /** Offene Urlaubsanträge (absences, status = 'pending'). */
  vacation: number;
  /** Krankmeldungen mit ausstehendem Attest (medical_certificate_status = 'pending'). */
  sick: number;
  /** Offene Reisekostenanträge (business_trips, status = 'pending'). */
  travel: number;
};

const EMPTY: PendingApprovalCounts = { vacation: 0, sick: 0, travel: 0 };

/**
 * Lädt die Anzahl offener Genehmigungen für die Menü-Badges.
 *
 * Fragt nur die Kategorien ab, die die aktuelle Rolle genehmigen darf, und
 * aktualisiert die Zahlen beim Mounten sowie bei jeder Navigation
 * (pathname-Wechsel). Es werden reine Count-Queries verwendet (head: true),
 * es werden also keine Datensätze übertragen. RLS greift zusätzlich.
 */
export function usePendingApprovals(): PendingApprovalCounts {
  const { isAdmin, isApprover, isHrManager } = useRoles();
  const pathname = usePathname();
  const [counts, setCounts] = useState<PendingApprovalCounts>(EMPTY);

  const canApproveVacation = isApprover;
  const canManageHr = isHrManager || isAdmin;

  useEffect(() => {
    let cancelled = false;

    const countPendingVacation = async (): Promise<number> => {
      const { count, error } = await supabase
        .from("absences")
        .select("*", { count: "exact", head: true })
        .in("type", ["vacation", "unpaid_leave", "comp_time"])
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    };

    const countPendingSick = async (): Promise<number> => {
      const { count, error } = await supabase
        .from("absences")
        .select("*", { count: "exact", head: true })
        .eq("type", "sick")
        .eq("medical_certificate_status", "pending");
      if (error) throw error;
      return count ?? 0;
    };

    const countPendingTravel = async (): Promise<number> => {
      const { count, error } = await supabase
        .from("business_trips")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    };

    const loadCounts = async () => {
      try {
        const [vacation, sick, travel] = await Promise.all([
          canApproveVacation ? countPendingVacation() : Promise.resolve(0),
          canManageHr ? countPendingSick() : Promise.resolve(0),
          canManageHr ? countPendingTravel() : Promise.resolve(0),
        ]);
        if (cancelled) return;
        setCounts({ vacation, sick, travel });
      } catch (error) {
        console.error("[usePendingApprovals] Zählen fehlgeschlagen:", error);
        if (!cancelled) setCounts(EMPTY);
      }
    };

    void loadCounts();

    return () => {
      cancelled = true;
    };
  }, [pathname, canApproveVacation, canManageHr]);

  return counts;
}
