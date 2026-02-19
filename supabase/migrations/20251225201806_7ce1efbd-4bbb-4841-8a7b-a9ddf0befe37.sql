-- HR-Manager können Abwesenheiten direkt erstellen
CREATE POLICY "HR managers can create absences directly"
ON public.absences
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'hr_manager'::app_role));

-- HR-Manager können Abwesenheiten löschen
CREATE POLICY "HR managers can delete any absence"
ON public.absences
FOR DELETE
USING (has_role(auth.uid(), 'hr_manager'::app_role));

-- HR-Manager können Korrekturbuchungen verwalten
CREATE POLICY "HR managers can manage corrections"
ON public.balance_corrections
FOR ALL
USING (has_role(auth.uid(), 'hr_manager'::app_role));