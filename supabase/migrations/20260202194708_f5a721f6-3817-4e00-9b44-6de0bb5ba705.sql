-- Halber Urlaubstag: nur für vacation-Typ gültig wenn start_date = end_date
ALTER TABLE absences 
ADD COLUMN is_half_day BOOLEAN DEFAULT false;

COMMENT ON COLUMN absences.is_half_day IS 
  'Halber Urlaubstag: nur gültig für type=vacation wenn start_date = end_date';