-- Indexes for foreign keys the app filters or joins on, flagged by Supabase's
-- performance advisor. They matter once the dataset grows: statistics group
-- questions by subtype and tag, image access checks look questions up by image,
-- and the model check groups answers by model.

create index if not exists questions_subtype on questions (subtype_id);
create index if not exists questions_image on questions (image_id);
create index if not exists image_tags_tag on image_tags (tag_id);
create index if not exists model_answers_model on model_answers (model_id);
create index if not exists model_samples_question on model_samples (question_id);
create index if not exists checker_slots_checker on checker_slots (checker_id);
create index if not exists assignments_annotator on assignments (annotator_id);
create index if not exists models_connection on models (connection_id);
