-- HR-Manager können alle Arbeitszeitpläne lesen (für Team-Übersicht und Reports)
CREATE POLICY "HR managers can view all work schedules"
ON employee_work_schedules
FOR SELECT
USING (has_role(auth.uid(), 'hr_manager'::app_role));