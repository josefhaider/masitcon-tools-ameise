import { Clock, Plane, Check, Users, Coffee, AlertCircle, BarChart3, Settings, LogOut, FileText, History, UsersRound, CalendarDays, Thermometer, GraduationCap, ScrollText, Database } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import masitconLogo from "@/assets/masitcon-logo.png";

interface AppSidebarProps {
  isAdmin: boolean;
  isApprover: boolean;
  isHrManager: boolean;
  activeView: string;
  onViewChange: (view: string) => void;
  onSignOut?: () => void;
  userName?: string;
}

export function AppSidebar({ isAdmin, isApprover, isHrManager, activeView, onViewChange, onSignOut, userName }: AppSidebarProps) {
  const { setOpenMobile, isMobile } = useSidebar();

  const handleNavigate = (view: string) => {
    onViewChange(view);
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleSignOut = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
    onSignOut?.();
  };

  return (
    <Sidebar collapsible="icon">
      {/* Header with Logo */}
      <SidebarHeader className="h-[53px] flex items-center px-2 border-b">
        <img
          src={masitconLogo}
          alt="masitcon"
          className="h-8 w-auto object-contain [image-rendering:auto] transition-[width] duration-200"
        />
      </SidebarHeader>

      <SidebarContent>
        {/* Allgemeine Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Zeiterfassung</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => handleNavigate("overview")}
                  isActive={activeView === "overview"}
                  tooltip="Übersicht"
                >
                  <BarChart3 className="h-4 w-4" />
                  <span>Übersicht</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => handleNavigate("calendar")}
                  isActive={activeView === "calendar"}
                  tooltip="Zeiterfassung"
                >
                  <Clock className="h-4 w-4" />
                  <span>Zeiterfassung</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => handleNavigate("vacation-request")}
                  isActive={activeView === "vacation-request"}
                  tooltip="Urlaub & Anträge"
                >
                  <Plane className="h-4 w-4" />
                  <span>Urlaub & Anträge</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => handleNavigate("vacation-planning")}
                  isActive={activeView === "vacation-planning"}
                  tooltip="Urlaubsplanung"
                >
                  <CalendarDays className="h-4 w-4" />
                  <span>Urlaubsplanung</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => handleNavigate("sick-leave")}
                  isActive={activeView === "sick-leave"}
                  tooltip="Krankmeldung"
                >
                  <Thermometer className="h-4 w-4" />
                  <span>Krankmeldung</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Genehmiger-Navigation */}
        {(isApprover || isHrManager || isAdmin) && (
          <SidebarGroup>
            <SidebarGroupLabel>Genehmigungen</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {isApprover && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => handleNavigate("vacation-approval")}
                      isActive={activeView === "vacation-approval"}
                      tooltip="Urlaubsanträge"
                    >
                      <Check className="h-4 w-4" />
                      <span>Urlaubsanträge</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {(isHrManager || isAdmin) && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => handleNavigate("sick-leave-admin")}
                      isActive={activeView === "sick-leave-admin"}
                      tooltip="Krankmeldungen"
                    >
                      <Thermometer className="h-4 w-4" />
                      <span>Krankmeldungen</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Reporting - for hr_manager and admin */}
        {(isHrManager || isAdmin) && (
          <SidebarGroup>
            <SidebarGroupLabel>Reporting</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("team-overview")}
                    isActive={activeView === "team-overview"}
                    tooltip="Team-Übersicht"
                  >
                    <BarChart3 className="h-4 w-4" />
                    <span>Team-Übersicht</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("reports")}
                    isActive={activeView === "reports" || activeView === "sick-leave-report" || activeView === "hours-report"}
                    tooltip="Reports & PDFs"
                  >
                    <FileText className="h-4 w-4" />
                    <span>Reports & PDFs</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* HR-Manager Verwaltung (Abwesenheiten & Korrekturen) */}
        {(isHrManager && !isAdmin) && (
          <SidebarGroup>
            <SidebarGroupLabel>Abwesenheitsverwaltung</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("absences")}
                    isActive={activeView === "absences"}
                    tooltip="Direkte Abwesenheiten"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>Direkte Abwesenheiten</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("corrections")}
                    isActive={activeView === "corrections"}
                    tooltip="Korrekturbuchungen"
                  >
                    <History className="h-4 w-4" />
                    <span>Korrekturbuchungen</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Admin-Navigation */}
        {isAdmin && (
          <SidebarGroup>
              <SidebarGroupLabel>Verwaltung</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => handleNavigate("employees")}
                      isActive={activeView === "employees"}
                      tooltip="Mitarbeiter"
                    >
                      <Users className="h-4 w-4" />
                      <span>Mitarbeiter</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={() => handleNavigate("teams")}
                      isActive={activeView === "teams"}
                      tooltip="Teams"
                    >
                      <UsersRound className="h-4 w-4" />
                      <span>Teams</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("breaks")}
                    isActive={activeView === "breaks"}
                    tooltip="Pausenregeln"
                  >
                    <Coffee className="h-4 w-4" />
                    <span>Pausenregeln</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("absences")}
                    isActive={activeView === "absences"}
                    tooltip="Direkte Abwesenheiten"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>Direkte Abwesenheiten</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("corrections")}
                    isActive={activeView === "corrections"}
                    tooltip="Korrekturbuchungen"
                  >
                    <History className="h-4 w-4" />
                    <span>Korrekturbuchungen</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("holidays")}
                    isActive={activeView === "holidays"}
                    tooltip="Feiertage"
                  >
                    <CalendarDays className="h-4 w-4" />
                    <span>Feiertage</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("school-holidays")}
                    isActive={activeView === "school-holidays"}
                    tooltip="Schulferien"
                  >
                    <GraduationCap className="h-4 w-4" />
                    <span>Schulferien</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("audit-log")}
                    isActive={activeView === "audit-log"}
                    tooltip="Audit-Protokoll"
                  >
                    <FileText className="h-4 w-4" />
                    <span>Audit-Protokoll</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => handleNavigate("data-transfer")}
                    isActive={activeView === "data-transfer"}
                    tooltip="Datentransfer"
                  >
                    <Database className="h-4 w-4" />
                    <span>Datentransfer</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer with Profile & Logout */}
      <SidebarFooter>
        <Separator className="mb-2" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => handleNavigate("changelog")}
              isActive={activeView === "changelog"}
              tooltip="Änderungsprotokoll"
            >
              <ScrollText className="h-4 w-4" />
              <span>Änderungsprotokoll</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => handleNavigate("profile")}
              isActive={activeView === "profile"}
              tooltip="Mein Profil"
            >
              <Settings className="h-4 w-4" />
              <span>Einstellungen</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {onSignOut && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={handleSignOut}
                tooltip="Abmelden"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut className="h-4 w-4" />
                <span>Abmelden</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}