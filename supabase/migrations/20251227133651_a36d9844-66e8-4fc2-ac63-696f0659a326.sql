-- Neue Policy: Alle authentifizierten Benutzer können genehmigte Urlaube sehen
-- (für den Planungskalender - Krankmeldungen bleiben geschützt)
CREATE POLICY "Everyone can view approved vacations for planning"
ON public.absences
FOR SELECT
USING (
  status = 'approved' 
  AND type IN ('vacation', 'unpaid_leave', 'comp_time')
);