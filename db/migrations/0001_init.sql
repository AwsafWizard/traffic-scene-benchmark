-- DhakaDrive-VQA annotation platform — core schema.
--
-- Only our own server talks to this database. Row-level security is switched on
-- for every table with no policies, so Supabase's public REST API (anon and
-- authenticated roles) can read and write nothing even if its key leaks. The
-- server connects as the table owner, which RLS does not restrict.

-- People -----------------------------------------------------------------------

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null check (length(display_name) between 1 and 80),
  role text not null check (role in ('admin', 'annotator')),
  password_hash text not null,
  active boolean not null default true,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  password_changed_at timestamptz not null default now(),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

-- There is exactly one admin account.
create unique index users_one_admin on users ((role)) where role = 'admin';

create table sessions (
  -- SHA-256 of the cookie token, so a database leak doesn't hand out sessions.
  id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

-- Taxonomy (all admin-editable) --------------------------------------------------

create table categories (
  id serial primary key,
  code text not null unique,
  name text not null,
  description text,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table subtypes (
  id serial primary key,
  category_id integer not null references categories (id),
  code text not null unique,
  name text not null,
  keywords text,
  -- V verifiable, C consensus, I inferential. Decides how questions are checked.
  verifiability text not null check (verifiability in ('V', 'C', 'I')),
  regional boolean not null default false,
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index subtypes_category on subtypes (category_id);

create table tag_groups (
  id serial primary key,
  name text not null unique,
  required boolean not null default false,
  sort integer not null default 0,
  active boolean not null default true
);

create table tags (
  id serial primary key,
  group_id integer not null references tag_groups (id),
  name text not null,
  sort integer not null default 0,
  active boolean not null default true,
  unique (group_id, name)
);

-- Images -------------------------------------------------------------------------

create table images (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references users (id),
  storage text not null check (storage in ('cloudinary', 'local')),
  -- Cloudinary public_id, or the file name for local development storage.
  storage_key text not null unique,
  version text,
  format text,
  width integer,
  height integer,
  bytes integer,
  created_at timestamptz not null default now()
);
create index images_uploader on images (uploader_id);

create table image_tags (
  image_id uuid not null references images (id) on delete cascade,
  tag_id integer not null references tags (id),
  primary key (image_id, tag_id)
);

-- Sprints --------------------------------------------------------------------------

create table sprints (
  id serial primary key,
  name text not null,
  status text not null default 'setup'
    check (status in ('setup', 'writing', 'verifying', 'closed')),
  model_sample_pct integer not null default 10 check (model_sample_pct between 1 and 100),
  created_at timestamptz not null default now(),
  writing_started_at timestamptz,
  verification_started_at timestamptz,
  closed_at timestamptz
);

-- Only one sprint is live at a time, so every annotator works on the same one.
create unique index sprints_one_live on sprints ((true)) where status in ('writing', 'verifying');

-- A topic given to one annotator: a whole category, or one subtype within it.
create table assignments (
  id serial primary key,
  sprint_id integer not null references sprints (id) on delete cascade,
  annotator_id uuid not null references users (id),
  category_id integer not null references categories (id),
  subtype_id integer references subtypes (id),
  target integer not null check (target > 0),
  created_at timestamptz not null default now()
);
create index assignments_sprint on assignments (sprint_id);

-- The two checkers drawn for a topic.
create table checker_slots (
  assignment_id integer not null references assignments (id) on delete cascade,
  slot integer not null check (slot in (1, 2)),
  checker_id uuid not null references users (id),
  primary key (assignment_id, slot),
  unique (assignment_id, checker_id)
);

-- Questions ---------------------------------------------------------------------------

create table questions (
  id uuid primary key default gen_random_uuid(),
  sprint_id integer not null references sprints (id),
  assignment_id integer not null references assignments (id),
  author_id uuid not null references users (id),
  image_id uuid not null references images (id),
  subtype_id integer not null references subtypes (id),
  -- Copied from the subtype when written, so later taxonomy edits don't change
  -- how an existing question is checked.
  verifiability text not null check (verifiability in ('V', 'C', 'I')),
  prompt text not null check (length(prompt) between 1 and 2000),
  -- [{"id": "a", "text": "..."}] in the order the setter wrote them.
  options jsonb not null,
  correct_option text not null,
  status text not null default 'written'
    check (status in ('written', 'checking', 'accepted', 'flagged', 'returned', 'dropped')),
  -- How it was settled: agreed, misread, admin_accepted, admin_fixed, dropped.
  resolution text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index questions_sprint on questions (sprint_id, status);
create index questions_author on questions (author_id);
create index questions_assignment on questions (assignment_id);

create table checks (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  checker_id uuid not null references users (id),
  -- v, c, second or third. On I questions it is set when the blind answer lands:
  -- whoever answers first plays "second".
  role text check (role in ('v', 'c', 'second', 'third')),
  -- Option ids in the order this checker was shown them.
  option_order jsonb not null,
  -- An option id, 'none' (none of these is correct) or 'cant_tell'.
  blind_choice text,
  -- The answer they typed for 'none', or their reason for 'cant_tell'.
  blind_note text,
  blind_at timestamptz,
  judgment text check (judgment in
    ('setter_mistake', 'misread', 'agree', 'disagree', 'all_agree', 'not_all_agree')),
  judgment_reason text,
  -- When the third checker says not all three agree: which answer is the odd one.
  odd_one text check (odd_one in ('setter', 'second', 'mine')),
  judged_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  unique (question_id, checker_id)
);
create index checks_checker on checks (checker_id, blind_at);

-- Models and the model check ----------------------------------------------------------

create table models (
  id serial primary key,
  name text not null unique,
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'manual')),
  model_id text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table model_samples (
  sprint_id integer not null references sprints (id) on delete cascade,
  question_id uuid not null references questions (id) on delete cascade,
  primary key (sprint_id, question_id)
);

create table model_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  model_id integer not null references models (id),
  option_order jsonb,
  chosen_option text,
  raw_output text,
  source text not null check (source in ('manual', 'api')),
  error text,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index model_answers_question on model_answers (question_id);

-- Audit ------------------------------------------------------------------------------------

create table audit_log (
  id bigserial primary key,
  actor_id uuid references users (id),
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_created on audit_log (created_at desc);

-- Lock the public API out ----------------------------------------------------------------

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
  end if;
end $$;
