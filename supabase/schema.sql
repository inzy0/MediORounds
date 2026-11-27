-- MediORounds: per-student progress, stored in Supabase (free tier).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Row Level Security means every student can read and write ONLY their own row; the public "anon" key
-- in the website cannot read anyone else's data.

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,   -- sessions, xp, badges, review deck, reflections, settings
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

drop policy if exists "read own progress"   on public.progress;
drop policy if exists "insert own progress" on public.progress;
drop policy if exists "update own progress" on public.progress;
drop policy if exists "delete own progress" on public.progress;

create policy "read own progress"   on public.progress for select using (auth.uid() = user_id);
create policy "insert own progress" on public.progress for insert with check (auth.uid() = user_id);
create policy "update own progress" on public.progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own progress" on public.progress for delete using (auth.uid() = user_id);

-- keep a size cap so one account cannot fill the free database (about 2 MB of JSON per student)
alter table public.progress drop constraint if exists progress_size_cap;
alter table public.progress add constraint progress_size_cap check (pg_column_size(data) < 2000000);

-- Let a signed-in student delete their own account and all their data (button on the Account page).
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
