-- Fix search_path for check_schedule_overlap function
CREATE OR REPLACE FUNCTION check_schedule_overlap()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;