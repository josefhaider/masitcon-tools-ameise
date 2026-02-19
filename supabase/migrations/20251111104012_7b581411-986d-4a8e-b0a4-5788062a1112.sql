-- Step 2: Add status columns to absences table
ALTER TABLE absences 
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Migrate existing absences to approved status
UPDATE absences 
SET status = 'approved', 
    approved_at = created_at,
    approved_by = created_by
WHERE status = 'pending' AND created_at < NOW();

-- Drop existing policies to recreate them
DROP POLICY IF EXISTS "Only admins can manage absences" ON absences;
DROP POLICY IF EXISTS "Users can view own absences" ON absences;

-- New RLS Policies

-- Users can create own vacation requests (status: pending)
CREATE POLICY "Users can create own vacation requests"
ON absences FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() 
  AND type = 'vacation' 
  AND status = 'pending'
);

-- Admins can create any absence (bypass workflow)
CREATE POLICY "Admins can create absences directly"
ON absences FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);

-- Users can view own absences (all status)
-- Approvers can view all absences
-- Admins can view all absences
CREATE POLICY "Users view own, approvers and admins view all"
ON absences FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() 
  OR has_role(auth.uid(), 'admin'::app_role) 
  OR has_role(auth.uid(), 'vacation_approver'::app_role)
);

-- Users can delete own pending requests
CREATE POLICY "Users can delete own pending requests"
ON absences FOR DELETE
TO authenticated
USING (
  user_id = auth.uid() 
  AND status = 'pending'
);

-- Admins can delete any absence
CREATE POLICY "Admins can delete any absence"
ON absences FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
);

-- Approvers can update pending requests to approved/rejected
CREATE POLICY "Approvers can update pending requests"
ON absences FOR UPDATE
TO authenticated
USING (
  status = 'pending' 
  AND (
    has_role(auth.uid(), 'vacation_approver'::app_role) 
    OR has_role(auth.uid(), 'admin'::app_role)
  )
)
WITH CHECK (
  status IN ('approved', 'rejected')
);

-- Admins can update any absence
CREATE POLICY "Admins can update any absence"
ON absences FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
);