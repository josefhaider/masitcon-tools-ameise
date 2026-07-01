"use client";
import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Clock,
  Plane,
  Check,
  Users,
  Coffee,
  AlertCircle,
  BarChart3,
  Settings,
  LogOut,
  FileText,
  History,
  UsersRound,
  CalendarDays,
  Thermometer,
  GraduationCap,
  ScrollText,
  Database,
  MoreHorizontal,
  Receipt,
  Globe,
} from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useRoles } from "@/contexts/permissions-context";
import { useProfile } from "@/contexts/profile-context";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type NavItem = {
  label: string;
  icon: React.ReactNode;
  to: string;
  matchExact?: boolean;
  matchPrefix?: string;
  badgeCount?: number;
};

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathnameRaw = usePathname();
  const pathname = pathnameRaw ?? "";
  const router = useRouter();
  const { isAdmin, isApprover, isHrManager } = useRoles();
  const pendingApprovals = usePendingApprovals();
  const profile = useProfile();

  const isCollapsed = !isExpanded && !isHovered;
  const showLabel = isExpanded || isHovered || isMobileOpen;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const isActive = (item: NavItem) => {
    if (item.matchExact) return pathname === item.to;
    if (item.matchPrefix) return pathname.startsWith(item.matchPrefix);
    return pathname === item.to || pathname.startsWith(item.to + "/");
  };

  const zeiterfassungItems: NavItem[] = [
    { label: "Übersicht", icon: <BarChart3 />, to: "/", matchExact: true },
    { label: "Zeiterfassung", icon: <Clock />, to: "/zeiterfassung" },
    { label: "Urlaub & Anträge", icon: <Plane />, to: "/urlaub" },
    { label: "Urlaubsplanung", icon: <CalendarDays />, to: "/urlaubsplanung" },
    { label: "Krankmeldung", icon: <Thermometer />, to: "/krankmeldung" },
    { label: "Reisekosten", icon: <Receipt />, to: "/reisekosten" },
  ];

  const genehmigungItems: NavItem[] = [
    ...(isApprover
      ? [
          {
            label: "Urlaubsanträge",
            icon: <Check />,
            to: "/genehmigungen/urlaub",
            badgeCount: pendingApprovals.vacation,
          },
        ]
      : []),
    ...(isHrManager || isAdmin
      ? [
          {
            label: "Krankmeldungen",
            icon: <Thermometer />,
            to: "/genehmigungen/krankmeldungen",
            badgeCount: pendingApprovals.sick,
          },
        ]
      : []),
    ...(isHrManager || isAdmin
      ? [
          {
            label: "Reisekosten",
            icon: <Receipt />,
            to: "/genehmigungen/reisekosten",
            badgeCount: pendingApprovals.travel,
          },
        ]
      : []),
  ];

  const reportingItems: NavItem[] = [
    { label: "Team-Übersicht", icon: <UsersRound />, to: "/reporting/team" },
    { label: "Reisekosten", icon: <Receipt />, to: "/reporting/reisekosten" },
    { label: "Reports & PDFs", icon: <FileText />, to: "/reporting", matchExact: true },
  ];

  const verwaltungItems: NavItem[] = [
    { label: "Mitarbeiter", icon: <Users />, to: "/admin/mitarbeiter" },
    { label: "Teams", icon: <UsersRound />, to: "/admin/teams" },
    { label: "Pausenregeln", icon: <Coffee />, to: "/admin/pausenregeln" },
    { label: "Direkte Abwesenheiten", icon: <AlertCircle />, to: "/admin/abwesenheiten" },
    { label: "Korrekturbuchungen", icon: <History />, to: "/admin/korrekturen" },
    { label: "Feiertage", icon: <CalendarDays />, to: "/admin/feiertage" },
    { label: "Reisekostensätze", icon: <Globe />, to: "/admin/reisekostensaetze" },
    { label: "Schulferien", icon: <GraduationCap />, to: "/admin/schulferien" },
    { label: "Audit-Protokoll", icon: <ScrollText />, to: "/admin/audit" },
    { label: "Datentransfer", icon: <Database />, to: "/admin/datentransfer" },
  ];

  const abwesenheitsverwaltungItems: NavItem[] = [
    { label: "Direkte Abwesenheiten", icon: <AlertCircle />, to: "/admin/abwesenheiten" },
    { label: "Korrekturbuchungen", icon: <History />, to: "/admin/korrekturen" },
  ];

  const renderNavItems = (items: NavItem[]) => (
    <ul className="flex flex-col gap-4">
      {items.map((item) => {
        const active = isActive(item);
        const count = item.badgeCount ?? 0;
        const badgeLabel = count > 99 ? "99+" : String(count);
        return (
          <li key={item.to}>
            <Link
              href={item.to}
              className={`menu-item group relative ${
                active ? "menu-item-active" : "menu-item-inactive"
              } ${isCollapsed ? "lg:justify-center" : "lg:justify-start"}`}
            >
              <span
                className={`relative ${
                  active ? "menu-item-icon-active" : "menu-item-icon-inactive"
                }`}
              >
                {item.icon}
                {count > 0 && !showLabel && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-2 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground"
                  >
                    {badgeLabel}
                  </span>
                )}
              </span>
              {showLabel && <span>{item.label}</span>}
              {count > 0 && showLabel && (
                <Badge className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs">
                  {badgeLabel}
                </Badge>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const renderGroup = (label: string, items: NavItem[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <h2
          className={`mb-4 flex text-sm leading-[20px] text-gray-400 uppercase lg:text-xs ${
            isCollapsed ? "lg:justify-center" : "justify-start"
          }`}
        >
          {showLabel ? label : <MoreHorizontal className="h-5 w-5" />}
        </h2>
        {renderNavItems(items)}
      </div>
    );
  };

  return (
    <aside
      className={`fixed top-16 bottom-0 left-0 z-50 flex flex-col border-r border-gray-200 bg-white px-5 pb-[env(safe-area-inset-bottom,0px)] text-gray-900 transition-all duration-300 ease-in-out lg:top-0 ${
        isMobileOpen
          ? "w-[85vw] max-w-[320px] lg:w-[290px]"
          : isExpanded || isHovered
            ? "w-[290px]"
            : "w-[90px]"
      } ${isMobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Logo */}
      <div
        className={`hidden py-8 lg:flex ${
          isCollapsed ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/Ameise.png"
            alt="AMEISE"
            width={64}
            height={64}
            className={`rounded-lg ${isExpanded || isHovered ? "h-16 w-16" : "h-12 w-12"}`}
            priority
          />
          {(isExpanded || isHovered) && (
            <div className="flex flex-col">
              <span className="text-[1.7rem] font-bold tracking-wide text-gray-800">
                AMEISE
              </span>
              <span className="text-[10px] leading-tight text-gray-400">
                masitcon Zeiterfassung
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto duration-300 ease-linear">
        <nav className="mb-6 pt-4 pb-6 lg:pt-0">
          <div className="flex flex-col gap-4">
            {renderGroup("Zeiterfassung", zeiterfassungItems)}

            {genehmigungItems.length > 0 &&
              renderGroup("Genehmigungen", genehmigungItems)}

            {(isHrManager || isAdmin) &&
              renderGroup("Reporting", reportingItems)}

            {isAdmin && renderGroup("Verwaltung", verwaltungItems)}

            {isHrManager &&
              !isAdmin &&
              renderGroup("Abwesenheitsverwaltung", abwesenheitsverwaltungItems)}
          </div>
        </nav>
      </div>

      {/* Footer-Navigation */}
      <div className="border-t border-gray-200 py-3">
        <ul className="flex flex-col gap-1">
          <li>
            <Link
              href="/changelog"
              className={`menu-item group ${
                pathname === "/changelog" ? "menu-item-active" : "menu-item-inactive"
              } ${isCollapsed ? "lg:justify-center" : "lg:justify-start"}`}
            >
              <span
                className={
                  pathname === "/changelog"
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }
              >
                <ScrollText />
              </span>
              {showLabel && <span>Änderungsprotokoll</span>}
            </Link>
          </li>
          <li>
            <Link
              href="/profil"
              className={`menu-item group ${
                pathname === "/profil" ? "menu-item-active" : "menu-item-inactive"
              } ${isCollapsed ? "lg:justify-center" : "lg:justify-start"}`}
            >
              <span
                className={
                  pathname === "/profil"
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }
              >
                <Settings />
              </span>
              {showLabel && <span>Einstellungen</span>}
            </Link>
          </li>
          <li>
            <button
              onClick={handleLogout}
              className={`menu-item group w-full text-red-500 hover:bg-red-50 ${
                isCollapsed ? "lg:justify-center" : "lg:justify-start"
              }`}
            >
              <span className="[&>svg]:h-6 [&>svg]:w-6 lg:[&>svg]:h-5 lg:[&>svg]:w-5">
                <LogOut />
              </span>
              {showLabel && <span>Abmelden</span>}
            </button>
          </li>
        </ul>
      </div>

      {/* Desktop footer: Powered by masitcon */}
      <div
        className={`hidden border-t border-gray-100 py-4 lg:flex ${
          isCollapsed ? "justify-center" : "flex-col items-center gap-1"
        }`}
      >
        {isExpanded || isHovered ? (
          <>
            <Image
              src="/Logo_masitcon_breit_RGB.png"
              alt="masitcon"
              width={120}
              height={24}
              className="opacity-40"
              style={{ width: "auto", height: "1.25rem" }}
            />
            <span className="text-[10px] text-gray-400">
              Ein Tool von masitcon
            </span>
          </>
        ) : (
          <Image
            src="/Logo_masitcon_breit_RGB.png"
            alt="masitcon"
            width={24}
            height={24}
            className="h-5 w-auto opacity-40"
          />
        )}
      </div>
    </aside>
  );
};

export default AppSidebar;
