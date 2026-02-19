-- Step 1: Add vacation_approver role to app_role enum
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'vacation_approver';