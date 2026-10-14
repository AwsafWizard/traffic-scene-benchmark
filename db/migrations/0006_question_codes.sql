-- Readable question codes: setter number, subtype, then that setter's count in
-- the subtype. "07-1.4-003" is annotator 07's third question in subtype 1.4.
--
-- Every annotator gets a number in the order they were created. The database
-- assigns the code when a question is written and gives it a new one when the
-- question moves to another subtype (by the setter while writing, or by the
-- admin filing it). Moving to Uncategorised keeps the code, so a question whose
-- subtype was deleted still carries its old one. Counts never go backwards, so
-- a deleted question's code is never given to another.

alter table users add column number integer unique;

update users u set number = n.number
from (select id, row_number() over (order by created_at, username)::int as number from users where role = 'annotator') n
where u.id = n.id;

create function assign_user_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.role = 'annotator' and new.number is null then
    new.number := coalesce((select max(number) from users), 0) + 1;
  end if;
  return new;
end $$;

create trigger users_number before insert on users
for each row execute function assign_user_number();

create table question_counters (
  author_id uuid not null references users (id),
  subtype_code text not null,
  last integer not null,
  primary key (author_id, subtype_code)
);

-- Short numbers are padded (07, 003); longer ones are kept whole.
create function pad_number(n integer, width integer) returns text
language sql immutable set search_path = public as $$
  select lpad(n::text, greatest(width, length(n::text)), '0')
$$;

alter table questions add column code text;

with numbered as (
  select q.id, q.author_id, st.code as subtype_code, u.number,
    row_number() over (partition by q.author_id, st.code order by q.created_at, q.id)::int as n
  from questions q join subtypes st on st.id = q.subtype_id join users u on u.id = q.author_id
)
update questions q set code = pad_number(coalesce(numbered.number, 0), 2) || '-' || numbered.subtype_code || '-' || pad_number(numbered.n, 3)
from numbered where numbered.id = q.id;

insert into question_counters (author_id, subtype_code, last)
select q.author_id, st.code, count(*)::int
from questions q join subtypes st on st.id = q.subtype_id
group by q.author_id, st.code;

alter table questions alter column code set not null;
create unique index questions_code on questions (code);

create function assign_question_code() returns trigger
language plpgsql set search_path = public as $$
declare
  st_code text;
  is_system boolean;
  setter integer;
  n integer;
begin
  if tg_op = 'UPDATE' and new.subtype_id is not distinct from old.subtype_id then
    return new;
  end if;
  select code, system into st_code, is_system from subtypes where id = new.subtype_id;
  if tg_op = 'UPDATE' and is_system then
    return new;
  end if;
  select number into setter from users where id = new.author_id;
  insert into question_counters as c (author_id, subtype_code, last) values (new.author_id, st_code, 1)
  on conflict (author_id, subtype_code) do update set last = c.last + 1
  returning last into n;
  new.code := pad_number(coalesce(setter, 0), 2) || '-' || st_code || '-' || pad_number(n, 3);
  return new;
end $$;

create trigger questions_code before insert or update of subtype_id on questions
for each row execute function assign_question_code();
