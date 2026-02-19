-- Add time_tracking_exempt field to profiles table
-- When true, no time tracking is expected for this employee (e.g. managers)
ALTER TABLE profiles 
ADD COLUMN time_tracking_exempt boolean DEFAULT false;

COMMENT ON COLUMN profiles.time_tracking_exempt IS 
  'Wenn true, wird keine Zeiterfassung für diesen Mitarbeiter erwartet (z.B. Führungskräfte)';