-- The video library, and where each captured frame came from.
--
-- Videos live in a private Hugging Face dataset repo. The admin adds them from
-- the repo (one by one, or a whole folder) and switches each on or off; setters
-- capture frames from the ones that are on. A frame records the repo, the
-- video's path in it and the second it was taken at. Images uploaded or pasted
-- by hand leave those null. Removing a video from the library leaves the frames
-- already taken from it alone.

create table videos (
  id serial primary key,
  repo text not null,
  -- Path inside the repo, e.g. "mirpur/VID_0412.mp4".
  path text not null,
  size_bytes bigint,
  active boolean not null default true,
  added_by uuid references users (id),
  created_at timestamptz not null default now(),
  unique (repo, path)
);

alter table images
  add column source_repo text,
  add column source_video text,
  add column source_time real;

create index images_source_video on images (source_repo, source_video) where source_video is not null;
