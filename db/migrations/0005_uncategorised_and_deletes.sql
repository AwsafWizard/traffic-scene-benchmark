-- Deleting subtypes and models.
--
-- A deleted subtype's questions move to a built-in "Uncategorised" type, keeping
-- a note of where they came from so the admin can file them again. The built-in
-- type and subtype are marked "system": hidden from annotators and never deletable.
-- A deleted model takes its recorded answers with it.

alter table categories add column system boolean not null default false;
alter table subtypes add column system boolean not null default false;
alter table questions add column former_subtype text;

insert into categories (code, name, description, sort, active, system)
values ('U', 'Uncategorised', 'Questions whose subtype was deleted. Move each one to a subtype from its page.', 999, false, true);

insert into subtypes (category_id, code, name, keywords, verifiability, sort, active, system)
select id, 'U.0', 'Uncategorised', 'Holds questions whose subtype was deleted', 'V', 0, false, true
from categories where code = 'U' and system;

alter table model_answers
  drop constraint model_answers_model_id_fkey,
  add constraint model_answers_model_id_fkey foreign key (model_id) references models (id) on delete cascade;
