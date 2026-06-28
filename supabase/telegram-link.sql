-- TrailMate — account-level Telegram linking. Run once in the Supabase SQL editor.

-- One Telegram chat per user account (for save confirmations + reminders).
create table if not exists user_telegram (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    chat_id    text not null,
    created_at timestamptz not null default now()
);

-- Short-lived, single-use tokens that map a Telegram /start payload back to the
-- user who generated the connect link.
create table if not exists telegram_link_tokens (
    token      text primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);
