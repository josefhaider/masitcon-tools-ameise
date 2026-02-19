-- Drop existing foreign key that points to auth.users
ALTER TABLE public.absences 
DROP CONSTRAINT IF EXISTS absences_user_id_fkey;

-- Add new foreign key to profiles table
ALTER TABLE public.absences 
ADD CONSTRAINT absences_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;