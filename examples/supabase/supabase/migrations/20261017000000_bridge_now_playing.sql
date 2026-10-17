-- Apple Music Widget Bridge: storage for the bridge-now-playing Edge Function.
-- Every name uses a bridge_ prefix so it can live beside other tables, buckets,
-- and functions in an existing project.

-- One row holds the current state and a reference to its artwork.
create table if not exists public.bridge_now_playing (
  id text primary key default 'current',
  status text not null default 'unavailable',
  is_playing boolean not null default false,
  title text,
  artist text,
  album text,
  album_artist text,
  genre text,
  year integer,
  duration_seconds double precision,
  position_seconds double precision,
  persistent_id text,
  captured_at timestamptz not null default 'epoch',
  artwork_persistent_id text,
  artwork_path text,
  updated_at timestamptz not null default now(),
  constraint bridge_now_playing_singleton_check check (id = 'current'),
  constraint bridge_now_playing_status_check check (
    status in ('playing', 'paused', 'stopped', 'not_open', 'unavailable')
  ),
  constraint bridge_now_playing_is_playing_check check (is_playing = (status = 'playing')),
  constraint bridge_now_playing_text_length_check check (
    coalesce(char_length(title), 0) <= 512
    and coalesce(char_length(artist), 0) <= 512
    and coalesce(char_length(album), 0) <= 512
    and coalesce(char_length(album_artist), 0) <= 512
    and coalesce(char_length(genre), 0) <= 512
  ),
  constraint bridge_now_playing_year_check check (year is null or year between 1 and 9999),
  constraint bridge_now_playing_duration_check check (duration_seconds is null or duration_seconds >= 0),
  constraint bridge_now_playing_position_check check (position_seconds is null or position_seconds >= 0),
  constraint bridge_now_playing_persistent_id_check check (
    persistent_id is null or persistent_id ~ '^[0-9A-F]{8,64}$'
  ),
  constraint bridge_now_playing_artwork_persistent_id_check check (
    artwork_persistent_id is null or artwork_persistent_id ~ '^[0-9A-F]{8,64}$'
  )
);

insert into public.bridge_now_playing (id) values ('current') on conflict (id) do nothing;

create or replace function public.bridge_now_playing_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.bridge_now_playing_set_updated_at() from public, anon, authenticated;

drop trigger if exists bridge_now_playing_set_updated_at on public.bridge_now_playing;
create trigger bridge_now_playing_set_updated_at
before insert or update on public.bridge_now_playing
for each row execute function public.bridge_now_playing_set_updated_at();

-- Only the Edge Function, which uses the service role, can read or write the
-- row. RLS stays enabled with no policies, so the anon and authenticated roles
-- have no access even if a later grant is added by mistake. Public reads go
-- through the function's GET route instead.
alter table public.bridge_now_playing enable row level security;

revoke all on table public.bridge_now_playing from public, anon, authenticated;
grant select, insert, update on table public.bridge_now_playing to service_role;

-- A public bucket serves artwork by URL without any storage.objects policy.
-- With no insert, update, or delete policy, anonymous clients cannot write it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bridge-now-playing-artwork', 'bridge-now-playing-artwork', true, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
