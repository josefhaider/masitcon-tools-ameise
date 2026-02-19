-- Drop existing restrictive policy for vacation-only inserts
DROP POLICY IF EXISTS "Users can create own vacation requests" ON absences;

-- New policy: Allow users to create vacation (pending) AND sick leave (approved) requests
CREATE POLICY "Users can create own absence requests"
ON absences FOR INSERT TO authenticated
WITH CHECK (
  (user_id = auth.uid()) AND 
  (
    -- Vacation requests: must be pending status
    (type = 'vacation' AND status = 'pending')
    OR
    -- Sick leave: directly approved (no approval workflow needed)
    (type = 'sick' AND status = 'approved')
  )
);

-- New policy: Users can update their own sick leave entries (to adjust end date)
CREATE POLICY "Users can update own sick leave"
ON absences FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND type = 'sick')
WITH CHECK (user_id = auth.uid() AND type = 'sick');