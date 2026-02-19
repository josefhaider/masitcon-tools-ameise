-- Add medical_certificate_status column to absences table
ALTER TABLE public.absences 
ADD COLUMN medical_certificate_status TEXT DEFAULT 'pending';

-- Add check constraint for valid values
ALTER TABLE public.absences 
ADD CONSTRAINT absences_medical_certificate_status_check 
CHECK (medical_certificate_status IN ('pending', 'received', 'not_required'));

-- Create index for filtering
CREATE INDEX idx_absences_medical_certificate_status ON public.absences(medical_certificate_status);

-- Comment for documentation
COMMENT ON COLUMN public.absences.medical_certificate_status IS 'Status des ärztlichen Attests: pending (ausstehend), received (erhalten), not_required (nicht erforderlich)';