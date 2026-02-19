-- Admins können alle Profile aktualisieren
CREATE POLICY "Admins can update all profiles"
ON profiles
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));