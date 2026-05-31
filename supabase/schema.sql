-- SPACEOKE / MK Karaoke - Supabase schema MVP real
-- Ejecuta este archivo en Supabase SQL Editor.
-- MVP: políticas abiertas para funcionar sin login. Para venta seria, luego cerramos Dev/Admin con Auth o Edge Functions.

create extension if not exists pgcrypto;

create table if not exists private_rooms (
  id uuid primary key default gen_random_uuid(),
  ticket text unique not null,
  admin_pin text not null default '5050',
  active boolean not null default true,
  expires_at date,
  business_name text not null,
  public_title text default 'Karaoke Night',
  slogan text default 'Escanea el QR para pedir tu canción',
  instagram text,
  location text,
  logo_url text,
  primary_color text default '#8b5cf6',
  secondary_color text default '#ec4899',
  background_color text default '#070713',
  total_songs_played integer default 0,
  total_singers integer default 0,
  total_sessions integer default 0,
  last_activity timestamptz,
  created_at timestamptz default now(),
  renewed_at timestamptz default now()
);

create table if not exists room_promos (
  id uuid primary key default gen_random_uuid(),
  room_ticket text not null references private_rooms(ticket) on delete cascade,
  promo_number integer not null check (promo_number between 1 and 3),
  enabled boolean default false,
  title text default '',
  subtitle text default '',
  description text default '',
  instagram text default '',
  font text default 'display',
  duration integer default 7,
  image_url text default '',
  image_name text default '',
  updated_at timestamptz default now(),
  unique(room_ticket, promo_number)
);

create table if not exists songs_queue (
  id uuid primary key default gen_random_uuid(),
  room_ticket text not null references private_rooms(ticket) on delete cascade,
  owner_id text not null,
  singer_name text not null,
  avatar text default '🎤',
  title text not null,
  artist text,
  duration text default '—',
  status text not null default 'queued' check (status in ('queued','playing','done','cancelled','no_show','skipped','video_error')),
  youtube_id text,
  youtube_url text,
  local_video_url text,
  source text default 'youtube',
  thumbnail text,
  version_key text,
  retry_count integer default 0,
  repeat_key text,
  requested_at timestamptz default now(),
  started_at timestamptz,
  ended_at timestamptz,
  video_error_reason text,
  retried_after_error boolean default false
);

create index if not exists idx_songs_queue_room_status_requested on songs_queue(room_ticket, status, requested_at);
create index if not exists idx_songs_queue_owner on songs_queue(room_ticket, owner_id);

create table if not exists video_catalog (
  id uuid primary key default gen_random_uuid(),
  youtube_id text unique,
  original_youtube_id text,
  title text not null,
  channel_title text,
  thumbnail text,
  url text,
  local_video_url text,
  search_query text,
  normalized_query text,
  is_karaoke boolean default true,
  blocked boolean default false,
  blocked_reason text,
  source text default 'youtube',
  requested_count integer default 0,
  play_count integer default 0,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_video_catalog_normalized_query on video_catalog using gin (to_tsvector('simple', coalesce(normalized_query,'') || ' ' || coalesce(title,'') || ' ' || coalesce(channel_title,'')));

create table if not exists blocked_videos (
  id uuid primary key default gen_random_uuid(),
  youtube_id text unique not null,
  title text,
  channel_title text,
  url text,
  reason text,
  resolved_with_local boolean default false,
  local_video_url text,
  blocked_at timestamptz default now(),
  resolved_at timestamptz
);

create table if not exists room_users (
  id uuid primary key default gen_random_uuid(),
  room_ticket text not null references private_rooms(ticket) on delete cascade,
  player_id text not null,
  display_name text,
  avatar text,
  last_seen_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(room_ticket, player_id)
);

create index if not exists idx_room_users_active on room_users(room_ticket, last_seen_at);

-- Storage buckets públicos para MVP.
insert into storage.buckets (id, name, public) values ('logos', 'logos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('promos', 'promos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public) values ('karaoke-videos', 'karaoke-videos', true)
on conflict (id) do nothing;

-- Row Level Security. MVP abierto para que funcione sin login.
alter table private_rooms enable row level security;
alter table room_promos enable row level security;
alter table songs_queue enable row level security;
alter table video_catalog enable row level security;
alter table blocked_videos enable row level security;
alter table room_users enable row level security;

create policy "public read private_rooms" on private_rooms for select using (true);
create policy "public write private_rooms MVP" on private_rooms for all using (true) with check (true);

create policy "public read room_promos" on room_promos for select using (true);
create policy "public write room_promos MVP" on room_promos for all using (true) with check (true);

create policy "public read songs_queue" on songs_queue for select using (true);
create policy "public write songs_queue MVP" on songs_queue for all using (true) with check (true);

create policy "public read video_catalog" on video_catalog for select using (true);
create policy "public write video_catalog MVP" on video_catalog for all using (true) with check (true);

create policy "public read blocked_videos" on blocked_videos for select using (true);
create policy "public write blocked_videos MVP" on blocked_videos for all using (true) with check (true);

create policy "public read room_users" on room_users for select using (true);
create policy "public write room_users MVP" on room_users for all using (true) with check (true);

create policy "public upload logos" on storage.objects for insert with check (bucket_id in ('logos','promos','karaoke-videos'));
create policy "public update files" on storage.objects for update using (bucket_id in ('logos','promos','karaoke-videos')) with check (bucket_id in ('logos','promos','karaoke-videos'));
create policy "public read files" on storage.objects for select using (bucket_id in ('logos','promos','karaoke-videos'));
create policy "public delete files" on storage.objects for delete using (bucket_id in ('logos','promos','karaoke-videos'));

-- Realtime: activa cambios en estas tablas.
do $$ begin
  begin alter publication supabase_realtime add table private_rooms; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table room_promos; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table songs_queue; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table room_users; exception when duplicate_object then null; end;
end $$;

-- Utilidad para contar canciones tocadas al pasar a done.
create or replace function increment_room_song_count()
returns trigger as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    update private_rooms
    set total_songs_played = coalesce(total_songs_played, 0) + 1,
        last_activity = now()
    where ticket = new.room_ticket;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_increment_room_song_count on songs_queue;
create trigger trg_increment_room_song_count
after update on songs_queue
for each row execute function increment_room_song_count();
