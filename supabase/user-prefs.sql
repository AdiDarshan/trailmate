-- TrailMate — standing user preferences. Run once in the Supabase SQL editor.
-- One free-text field per user, injected into every agent turn (trails, food,
-- hotels). Kept deliberately unstructured — the LLM consumes it verbatim.

create table if not exists user_prefs (
    user_id     uuid primary key references auth.users(id) on delete cascade,
    preferences text not null default '',
    updated_at  timestamptz not null default now()
);

-- Owner-only access; the server's user-scoped client is subject to these.
alter table user_prefs enable row level security;

drop policy if exists "prefs_select_own" on user_prefs;
drop policy if exists "prefs_insert_own" on user_prefs;
drop policy if exists "prefs_update_own" on user_prefs;

create policy "prefs_select_own" on user_prefs for select using (auth.uid() = user_id);
create policy "prefs_insert_own" on user_prefs for insert with check (auth.uid() = user_id);
create policy "prefs_update_own" on user_prefs for update using (auth.uid() = user_id);
