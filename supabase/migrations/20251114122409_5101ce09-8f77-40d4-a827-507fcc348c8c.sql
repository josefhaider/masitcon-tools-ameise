-- Add new columns for temporal versioning and break times
ALTER TABLE employee_work_schedules 
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS valid_to DATE;

-- Add check constraint: valid_to must be after valid_from
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_period_check'
    AND conrelid = 'public.employee_work_schedules'::regclass
  ) THEN
    ALTER TABLE employee_work_schedules
      ADD CONSTRAINT valid_period_check
      CHECK (valid_to IS NULL OR valid_to >= valid_from);
  END IF;
END $$;

-- Drop old unique constraint if exists
ALTER TABLE employee_work_schedules 
  DROP CONSTRAINT IF EXISTS employee_work_schedules_user_id_day_of_week_key;

-- Create new unique index: one schedule per user, weekday, and valid_from date
CREATE UNIQUE INDEX IF NOT EXISTS employee_work_schedules_unique_period 
  ON employee_work_schedules(user_id, day_of_week, valid_from);

-- Function to check for overlapping schedule periods
CREATE OR REPLACE FUNCTION check_schedule_overlap()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM employee_work_schedules
    WHERE user_id = NEW.user_id
      AND day_of_week = NEW.day_of_week
      AND id != NEW.id
      AND (
        -- New period starts within existing period
        (NEW.valid_from >= valid_from AND NEW.valid_from <= COALESCE(valid_to, '9999-12-31'::date))
        OR
        -- New period ends within existing period
        (COALESCE(NEW.valid_to, '9999-12-31'::date) >= valid_from AND COALESCE(NEW.valid_to, '9999-12-31'::date) <= COALESCE(valid_to, '9999-12-31'::date))
        OR
        -- New period completely encompasses existing period
        (NEW.valid_from <= valid_from AND COALESCE(NEW.valid_to, '9999-12-31'::date) >= COALESCE(valid_to, '9999-12-31'::date))
      )
  ) THEN
    RAISE EXCEPTION 'Überlappende Arbeitszeit-Perioden für diesen Wochentag';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to prevent overlapping schedule periods
DROP TRIGGER IF EXISTS prevent_schedule_overlap ON employee_work_schedules;
CREATE TRIGGER prevent_schedule_overlap
  BEFORE INSERT OR UPDATE ON employee_work_schedules
  FOR EACH ROW EXECUTE FUNCTION check_schedule_overlap();

-- Comment for documentation
COMMENT ON COLUMN employee_work_schedules.break_minutes IS 'Soll-Pause in Minuten für diesen Arbeitstag';
COMMENT ON COLUMN employee_work_schedules.valid_from IS 'Gültig ab diesem Datum (inklusiv)';
COMMENT ON COLUMN employee_work_schedules.valid_to IS 'Gültig bis zu diesem Datum (inklusiv), NULL = unbefristet';