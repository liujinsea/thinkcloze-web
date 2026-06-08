create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_anonymous boolean not null default false,
  unlocked_sets integer[] not null default array[]::integer[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists is_anonymous boolean not null default false;

alter table public.profiles
  add column if not exists unlocked_sets integer[] not null default array[]::integer[];

create table if not exists public.set_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_submission_id text not null,
  set_id integer not null check (set_id > 0),
  accuracy numeric(5,2) not null check (accuracy >= 0 and accuracy <= 100),
  correct_count integer not null check (correct_count >= 0),
  blank_count integer not null check (blank_count > 0),
  elapsed_seconds integer not null check (elapsed_seconds >= 0),
  user_is_anonymous boolean not null default false,
  submitted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_submission_id)
);

alter table public.set_submissions
  add column if not exists user_is_anonymous boolean not null default false;

create table if not exists public.blank_answer_records (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.set_submissions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_submission_id text not null,
  set_id integer not null check (set_id > 0),
  blank_index integer not null check (blank_index > 0),
  user_answer text not null default '',
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, client_submission_id, blank_index)
);

create table if not exists public.user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  event_name text not null check (event_name in ('quiz_started', 'half_complete', 'submitted')),
  set_id integer check (set_id > 0),
  blank_index integer check (blank_index is null or blank_index > 0),
  event_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index if not exists set_submissions_user_id_idx
  on public.set_submissions (user_id);

create index if not exists set_submissions_submitted_at_idx
  on public.set_submissions (submitted_at desc);

create index if not exists blank_answer_records_user_id_idx
  on public.blank_answer_records (user_id);

create index if not exists user_events_user_id_idx
  on public.user_events (user_id);

create index if not exists user_events_event_name_idx
  on public.user_events (event_name);

create index if not exists user_events_created_at_idx
  on public.user_events (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_submissions_set_updated_at on public.set_submissions;
create trigger set_submissions_set_updated_at
before update on public.set_submissions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, is_anonymous)
  values (new.id, new.email, false)
  on conflict (id) do update set
    email = excluded.email,
    is_anonymous = excluded.is_anonymous;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.set_submissions enable row level security;
alter table public.blank_answer_records enable row level security;
alter table public.user_events enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists set_submissions_select_own on public.set_submissions;
create policy set_submissions_select_own
on public.set_submissions for select
using (auth.uid() = user_id);

drop policy if exists set_submissions_insert_own on public.set_submissions;
create policy set_submissions_insert_own
on public.set_submissions for insert
with check (auth.uid() = user_id);

drop policy if exists set_submissions_update_own on public.set_submissions;
create policy set_submissions_update_own
on public.set_submissions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists blank_answer_records_select_own on public.blank_answer_records;
create policy blank_answer_records_select_own
on public.blank_answer_records for select
using (auth.uid() = user_id);

drop policy if exists blank_answer_records_insert_own on public.blank_answer_records;
create policy blank_answer_records_insert_own
on public.blank_answer_records for insert
with check (auth.uid() = user_id);

drop policy if exists blank_answer_records_update_own on public.blank_answer_records;
create policy blank_answer_records_update_own
on public.blank_answer_records for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_events_select_own on public.user_events;
create policy user_events_select_own
on public.user_events for select
using (auth.uid() = user_id);

drop policy if exists user_events_insert_own on public.user_events;
create policy user_events_insert_own
on public.user_events for insert
with check (auth.uid() = user_id);

drop policy if exists user_events_update_own on public.user_events;
create policy user_events_update_own
on public.user_events for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create or replace function public.get_public_stats()
returns table(metric text, value bigint)
language sql
security definer
set search_path = public
as $$
  select 'users'::text, count(*)::bigint from public.profiles
  union all
  select 'quiz_started'::text, count(*)::bigint from public.user_events where event_name = 'quiz_started'
  union all
  select 'half_complete'::text, count(*)::bigint from public.user_events where event_name = 'half_complete'
  union all
  select 'submitted'::text, count(*)::bigint from public.user_events where event_name = 'submitted'
  union all
  select 'attempts'::text, count(*)::bigint from public.set_submissions;
$$;

grant execute on function public.get_public_stats() to anon, authenticated;
