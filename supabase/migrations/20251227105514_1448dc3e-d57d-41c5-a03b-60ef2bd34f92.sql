-- Update RLS policy to allow users to create own requests with new absence types
DROP POLICY IF EXISTS "Users can create own absence requests" ON public.absences;

CREATE POLICY "Users can create own absence requests" 
ON public.absences 
FOR INSERT 
WITH CHECK (
  (user_id = auth.uid()) AND (
    -- Vacation types require pending status
    ((type IN ('vacation', 'unpaid_leave', 'comp_time')) AND (status = 'pending'))
    OR
    -- Sick leave is auto-approved
    ((type = 'sick') AND (status = 'approved'))
  )
);