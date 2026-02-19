-- Performance indexes for RLS and frequent queries
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id ON public.time_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_absences_user_id ON public.absences (user_id);
CREATE INDEX IF NOT EXISTS idx_balance_corrections_user_id ON public.balance_corrections (user_id);
CREATE INDEX IF NOT EXISTS idx_employee_work_schedules_user_id ON public.employee_work_schedules (user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON public.team_members (user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_date ON public.time_entries (user_id, date);
CREATE INDEX IF NOT EXISTS idx_absences_user_status ON public.absences (user_id, status);
