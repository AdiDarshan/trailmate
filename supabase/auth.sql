-- TrailMate — ownership + Row-Level Security. Run once in the Supabase SQL editor,
-- AFTER enabling the Google auth provider.

-- Owner of each trip.
alter table trips add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists trips_user_id on trips(user_id);

-- Lock the trips table to its owner. The server uses the service_role key for
-- system tasks (reminders cron), which bypasses RLS; these policies protect
-- against any access made with the public anon key.
alter table trips enable row level security;

drop policy if exists "trips_select_own" on trips;
drop policy if exists "trips_insert_own" on trips;
drop policy if exists "trips_update_own" on trips;
drop policy if exists "trips_delete_own" on trips;

create policy "trips_select_own" on trips for select using (auth.uid() = user_id);
create policy "trips_insert_own" on trips for insert with check (auth.uid() = user_id);
create policy "trips_update_own" on trips for update using (auth.uid() = user_id);
create policy "trips_delete_own" on trips for delete using (auth.uid() = user_id);