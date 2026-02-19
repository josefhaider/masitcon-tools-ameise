-- Neue Werte zum absence_type Enum hinzufügen
ALTER TYPE absence_type ADD VALUE IF NOT EXISTS 'unpaid_leave';
ALTER TYPE absence_type ADD VALUE IF NOT EXISTS 'comp_time';