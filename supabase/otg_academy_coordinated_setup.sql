-- OTG ACADEMY: COORDINATED DATABASE SETUP
-- Purpose: one ordered deployment script for student approval, academy learning,
-- and persistent lesson progress.
-- This script combines the existing repository migrations in dependency order.
--
-- SAFETY:
-- * Additive setup: uses CREATE TABLE IF NOT EXISTS and guarded policy creation.
-- * Contains no DROP TABLE, TRUNCATE, or DELETE statements.
-- * The approval migration backfills profiles for existing Auth users and assigns
--   the intended administrator email the admin/approved role.
-- * Review the script before running it in Supabase SQL Editor.
-- * This script does not prove a live deployment succeeded until the final
--   verification queries return expected results.
--
-- Repository: PrinceOnaJb/otg-ai-website-builder
-- Run as one complete script in the Supabase SQL Editor for the OTG project.
-- If Supabase reports an error, stop and share the exact error; do not repeatedly
-- rerun only fragments without checking the cause.



-- ============================================================
-- STUDENT APPROVAL FOUNDATION
-- Source file: supabase/otg_student_approval.sql
-- ============================================================

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

do $otg$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created_otg_profile'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ) then
    create trigger on_auth_user_created_otg_profile
    after insert on auth.users
    for each row execute procedure public.handle_new_otg_user();
  end if;
end;
$otg$;

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

do $otg$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'OTG users can read own profile or admin can read all'
  ) then
    create policy "OTG users can read own profile or admin can read all"
    on public.profiles for select
    to authenticated
    using (id = (select auth.uid()) or (select public.is_otg_admin()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'OTG admin can update profiles'
  ) then
    create policy "OTG admin can update profiles"
    on public.profiles for update
    to authenticated
    using ((select public.is_otg_admin()))
    with check ((select public.is_otg_admin()));
  end if;
end;
$otg$;

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

do $otg$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_otg_profile_updated_at'
      and tgrelid = 'public.profiles'::regclass
      and not tgisinternal
  ) then
    create trigger set_otg_profile_updated_at
    before update on public.profiles
    for each row execute procedure public.set_otg_profile_updated_at();
  end if;
end;
$otg$;

-- Verify: this should return the profiles table and your admin profile.
select table_name
from information_schema.tables
where table_schema = 'public' and table_name = 'profiles';

select email, role, approval_status
from public.profiles
where lower(coalesce(email, '')) = 'perfectpairs2021@gmail.com';



-- ============================================================
-- ACADEMY LEARNING TABLES AND POLICIES
-- Source file: supabase/otg_academy_learning.sql
-- ============================================================

-- OTG GRAPHIC Academy learning features
-- Run once in Supabase SQL Editor after otg_student_approval.sql.
-- Safe to rerun: tables and policies are created only when missing.

create table if not exists public.academy_lessons (
  id bigint generated by default as identity primary key,
  title text not null,
  course text not null default 'Getting Started',
  description text not null default '',
  content text not null default '',
  video_url text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_assignments (
  id bigint generated by default as identity primary key,
  title text not null,
  instructions text not null default '',
  course text not null default 'Getting Started',
  due_at timestamptz,
  is_published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_submissions (
  id bigint generated by default as identity primary key,
  assignment_id bigint not null references public.academy_assignments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  submission_text text not null default '',
  file_url text,
  status text not null default 'submitted' check (status in ('submitted','reviewing','needs_changes','approved')),
  coach_feedback text not null default '',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (assignment_id, student_id)
);

create table if not exists public.academy_announcements (
  id bigint generated by default as identity primary key,
  title text not null,
  message text not null,
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.academy_discussions (
  id bigint generated by default as identity primary key,
  student_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_discussion_replies (
  id bigint generated by default as identity primary key,
  discussion_id bigint not null references public.academy_discussions(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_otg_approved_student()
returns boolean
language sql
stable
security definer
set search_path = ''
as $otg$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.approval_status = 'approved'
  );
$otg$;

revoke all on function public.is_otg_approved_student() from public;
grant execute on function public.is_otg_approved_student() to authenticated;

alter table public.academy_lessons enable row level security;
alter table public.academy_assignments enable row level security;
alter table public.academy_submissions enable row level security;
alter table public.academy_announcements enable row level security;
alter table public.academy_discussions enable row level security;
alter table public.academy_discussion_replies enable row level security;

do $otg$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_lessons' and policyname='Approved students read published lessons') then
    create policy "Approved students read published lessons" on public.academy_lessons for select to authenticated
      using (is_published = true and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_lessons' and policyname='Admins manage lessons') then
    create policy "Admins manage lessons" on public.academy_lessons for all to authenticated
      using ((select public.is_otg_admin())) with check ((select public.is_otg_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_assignments' and policyname='Approved students read published assignments') then
    create policy "Approved students read published assignments" on public.academy_assignments for select to authenticated
      using (is_published = true and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_assignments' and policyname='Admins manage assignments') then
    create policy "Admins manage assignments" on public.academy_assignments for all to authenticated
      using ((select public.is_otg_admin())) with check ((select public.is_otg_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_submissions' and policyname='Students read own submissions or admin reads all') then
    create policy "Students read own submissions or admin reads all" on public.academy_submissions for select to authenticated
      using (student_id = (select auth.uid()) or (select public.is_otg_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_submissions' and policyname='Approved students submit own work') then
    create policy "Approved students submit own work" on public.academy_submissions for insert to authenticated
      with check (student_id = (select auth.uid()) and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_submissions' and policyname='Approved students update own submissions') then
    create policy "Approved students update own submissions" on public.academy_submissions for update to authenticated
      using (student_id = (select auth.uid()) and (select public.is_otg_approved_student()))
      with check (student_id = (select auth.uid()) and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_submissions' and policyname='Admins manage submissions') then
    create policy "Admins manage submissions" on public.academy_submissions for all to authenticated
      using ((select public.is_otg_admin())) with check ((select public.is_otg_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_announcements' and policyname='Approved students read announcements') then
    create policy "Approved students read announcements" on public.academy_announcements for select to authenticated
      using (is_published = true and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_announcements' and policyname='Admins manage announcements') then
    create policy "Admins manage announcements" on public.academy_announcements for all to authenticated
      using ((select public.is_otg_admin())) with check ((select public.is_otg_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_discussions' and policyname='Approved students read discussions') then
    create policy "Approved students read discussions" on public.academy_discussions for select to authenticated
      using ((select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_discussions' and policyname='Approved students create discussions') then
    create policy "Approved students create discussions" on public.academy_discussions for insert to authenticated
      with check (student_id = (select auth.uid()) and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_discussions' and policyname='Students update own discussions') then
    create policy "Students update own discussions" on public.academy_discussions for update to authenticated
      using (student_id = (select auth.uid()) and (select public.is_otg_approved_student()))
      with check (student_id = (select auth.uid()) and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_discussions' and policyname='Admins manage discussions') then
    create policy "Admins manage discussions" on public.academy_discussions for all to authenticated
      using ((select public.is_otg_admin())) with check ((select public.is_otg_admin()));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_discussion_replies' and policyname='Approved students read replies') then
    create policy "Approved students read replies" on public.academy_discussion_replies for select to authenticated
      using ((select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_discussion_replies' and policyname='Approved students create own replies') then
    create policy "Approved students create own replies" on public.academy_discussion_replies for insert to authenticated
      with check (student_id = (select auth.uid()) and (select public.is_otg_approved_student()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='academy_discussion_replies' and policyname='Admins manage replies') then
    create policy "Admins manage replies" on public.academy_discussion_replies for all to authenticated
      using ((select public.is_otg_admin())) with check ((select public.is_otg_admin()));
  end if;
end;
$otg$;

grant select on public.academy_lessons, public.academy_assignments, public.academy_announcements,
  public.academy_discussions, public.academy_discussion_replies to authenticated;
grant select, insert, update on public.academy_submissions to authenticated;
grant insert on public.academy_discussions, public.academy_discussion_replies to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Verify that the six learning tables exist after running this script.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'academy_lessons','academy_assignments','academy_submissions',
    'academy_announcements','academy_discussions','academy_discussion_replies'
  )
order by table_name;



-- ============================================================
-- LESSON COMPLETION AND COURSE PROGRESS
-- Source file: supabase/otg_academy_lesson_progress.sql
-- ============================================================

-- OTG GRAPHIC Academy: persistent lesson completion and progress
-- Run this migration once in Supabase SQL Editor after:
--   1) supabase/otg_student_approval.sql
--   2) supabase/otg_academy_learning.sql
-- Additive migration: creates a new progress table and policies only when missing.
-- It contains no DROP statements and does not modify existing student, lesson, project, or product rows.

create table if not exists public.academy_lesson_progress (
  id bigint generated by default as identity primary key,
  student_id uuid not null references auth.users(id) on delete cascade,
  lesson_id bigint not null references public.academy_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (student_id, lesson_id)
);

create index if not exists academy_lesson_progress_student_idx
  on public.academy_lesson_progress (student_id);

create index if not exists academy_lesson_progress_lesson_idx
  on public.academy_lesson_progress (lesson_id);

alter table public.academy_lesson_progress enable row level security;

-- Students can read only their own progress, and only while approved.
do $otg$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'academy_lesson_progress'
      and policyname = 'Students read own lesson progress'
  ) then
    create policy "Students read own lesson progress"
      on public.academy_lesson_progress
      for select to authenticated
      using (
        student_id = (select auth.uid())
        and (select public.is_otg_approved_student())
      );
  end if;

-- Students can mark only their own published lessons complete.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'academy_lesson_progress'
      and policyname = 'Approved students complete own published lessons'
  ) then
    create policy "Approved students complete own published lessons"
      on public.academy_lesson_progress
      for insert to authenticated
      with check (
        student_id = (select auth.uid())
        and (select public.is_otg_approved_student())
        and exists (
          select 1
          from public.academy_lessons l
          where l.id = lesson_id
            and l.is_published = true
        )
      );
  end if;

-- Supports safe upsert/retry for the same student's lesson without allowing
-- changes to another student's progress or to an unpublished lesson.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'academy_lesson_progress'
      and policyname = 'Approved students update own lesson progress'
  ) then
    create policy "Approved students update own lesson progress"
      on public.academy_lesson_progress
      for update to authenticated
      using (
        student_id = (select auth.uid())
        and (select public.is_otg_approved_student())
      )
      with check (
        student_id = (select auth.uid())
        and (select public.is_otg_approved_student())
        and exists (
          select 1
          from public.academy_lessons l
          where l.id = lesson_id
            and l.is_published = true
        )
      );
  end if;
end;
$otg$;

grant select, insert, update on public.academy_lesson_progress to authenticated;
grant usage, select on sequence public.academy_lesson_progress_id_seq to authenticated;

-- Verification: this should return the new table and its three policies.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'academy_lesson_progress';

select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'academy_lesson_progress'
order by policyname;


-- FINAL COORDINATED VERIFICATION
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles',
    'academy_lessons',
    'academy_assignments',
    'academy_submissions',
    'academy_announcements',
    'academy_discussions',
    'academy_discussion_replies',
    'academy_lesson_progress'
  )
ORDER BY table_name;

SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'academy_lessons', 'academy_lesson_progress')
ORDER BY tablename, policyname;

SELECT email, role, approval_status
FROM public.profiles
WHERE lower(coalesce(email, '')) = 'perfectpairs2021@gmail.com';
