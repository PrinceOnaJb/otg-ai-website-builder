-- OTG GRAPHIC Academy: student approval foundation
-- Run this file once in Supabase SQL Editor for project actwvvokfdemobgsfctx.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'student' check (role in ('admin', 'student')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A SECURITY DEFINER helper avoids recursive RLS checks on profiles.
create or replace function public.is_otg_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.approval_status = 'approved'
  );
$$;

revoke all on function public.is_otg_admin() from public;
grant execute on function public.is_otg_admin() to authenticated;

-- Create a profile automatically for each new Auth user.
create or replace function public.handle_new_otg_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first_admin boolean;
begin
  is_first_admin := lower(coalesce(new.email, '')) = 'perfectpairs2021@gmail.com';

  insert into public.profiles (id, email, role, approval_status)
  values (
    new.id,
    new.email,
    case when is_first_admin then 'admin' else 'student' end,
    case when is_first_admin then 'approved' else 'pending' end
  )
  on conflict (id) do update
    set email = excluded.email,
        role = case when is_first_admin then 'admin' else public.profiles.role end,
        approval_status = case when is_first_admin then 'approved' else public.profiles.approval_status end,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_otg_profile on auth.users;
create trigger on_auth_user_created_otg_profile
after insert on auth.users
for each row execute procedure public.handle_new_otg_user();

-- Backfill accounts that already existed before this trigger was installed.
insert into public.profiles (id, email, role, approval_status)
select
  u.id,
  u.email,
  case when lower(coalesce(u.email, '')) = 'perfectpairs2021@gmail.com' then 'admin' else 'student' end,
  case when lower(coalesce(u.email, '')) = 'perfectpairs2021@gmail.com' then 'approved' else 'pending' end
from auth.users u
on conflict (id) do update
set email = excluded.email,
    role = case when lower(coalesce(excluded.email, '')) = 'perfectpairs2021@gmail.com' then 'admin' else public.profiles.role end,
    approval_status = case when lower(coalesce(excluded.email, '')) = 'perfectpairs2021@gmail.com' then 'approved' else public.profiles.approval_status end,
    updated_at = now();

drop policy if exists "OTG users can read own profile or admin can read all" on public.profiles;
create policy "OTG users can read own profile or admin can read all"
on public.profiles for select
to authenticated
using (id = (select auth.uid()) or (select public.is_otg_admin()));

drop policy if exists "OTG admin can update profiles" on public.profiles;
create policy "OTG admin can update profiles"
on public.profiles for update
to authenticated
using ((select public.is_otg_admin()))
with check ((select public.is_otg_admin()));

grant select on public.profiles to authenticated;
grant update (approval_status, updated_at) on public.profiles to authenticated;

-- Keep updated_at current on profile edits.
create or replace function public.set_otg_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_otg_profile_updated_at on public.profiles;
create trigger set_otg_profile_updated_at
before update on public.profiles
for each row execute procedure public.set_otg_profile_updated_at();

-- Verify: this should return the profiles table and your admin profile.
select table_name
from information_schema.tables
where table_schema = 'public' and table_name = 'profiles';

select email, role, approval_status
from public.profiles
where lower(coalesce(email, '')) = 'perfectpairs2021@gmail.com';
