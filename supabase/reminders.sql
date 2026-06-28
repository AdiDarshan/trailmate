-- TrailMate — proactive reminders (Telegram). Run once in the Supabase SQL editor.

-- Machine-readable trip start date so the scheduler can compute "the day before
-- day N". (The existing `dates` column is a human display string.)
alter table trips add column if not exists start_date date;

-- Which Telegram chat receives reminders for a given trip.
create table if not exists subscriptions (
    trip_id    text not null references trips(id) on delete cascade,
    chat_id    text not null,
    created_at timestamptz not null default now(),
    primary key (trip_id, chat_id)
);

-- Dedupe log so a given reminder is sent at most once.
create table if not exists reminders_sent (
    trip_id    text not null,
    kind       text not null,         -- e.g. 'daily_summary'
    day_number integer not null,      -- 0 for trip-level reminders
    chat_id    text not null,
    sent_at    timestamptz not null default now(),
    primary key (trip_id, kind, day_number, chat_id)
);
