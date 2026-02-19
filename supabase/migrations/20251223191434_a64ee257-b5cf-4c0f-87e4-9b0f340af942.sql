-- RLS Policy: HR managers can view all absences
CREATE POLICY "HR managers can view all absences"
ON absences FOR SELECT
USING (
  has_role(auth.uid(), 'hr_manager'::app_role)
);

-- RLS Policy: HR managers can update sick leave entries (for AU status)
CREATE POLICY "HR managers can update sick leave"
ON absences FOR UPDATE
USING (
  type = 'sick'::absence_type AND 
  has_role(auth.uid(), 'hr_manager'::app_role)
);

-- HR managers can view all time entries for reports
CREATE POLICY "HR managers can view all time entries"
ON time_entries FOR SELECT
USING (
  has_role(auth.uid(), 'hr_manager'::app_role)
);