-- The Real World – Quest Log: Datenbank-Schema für Supabase
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen.
-- Danach die Quest-Texte mit dem Seed-Skript einspielen (liegt NICHT in diesem Repo).
--
-- Tabellen
--   phases          6 Phasen (Noob Phase … The final Step) inkl. Belohnungs-Titel
--   quests          100 Quests, eine pro Level
--   profiles        ein Spieler pro Benutzerkonto (Rolle, Spielername, Geburtsdatum, Profilbild,
--                   Sichtbarkeit, Grundregeln, Notizen)
--   quest_progress  welche Quests ein Spieler wann abgeschlossen hat
--   Storage-Bucket "avatars"  Profilbilder (privat), je Spieler im Ordner <user-id>/
--
-- Spielregeln, die die Datenbank selbst durchsetzt
--   - Grundregeln (Starthilfe, Hardcore Mode) sind nach Spielbeginn fest.
--   - Starthilfe: nur vor Spielbeginn dürfen Quests als "schon erledigt" markiert werden.
--   - Hardcore Mode: Quest n erst, wenn 1 … n-1 abgeschlossen sind.
--   - Level 100 erst, wenn alle Level 1 … 99 abgeschlossen sind (gilt immer).
--
-- Rollen
--   gamemaster  verwaltet die Konten (Seite gamemaster.html + Edge Function "gamemaster")
--   spieler     normales Mitglied (Standard)
--   Die Rolle kann man sich nicht selbst geben: nur der SQL Editor und die Gamemaster-Funktion ändern sie.

-- ───────────────────────── Tabellen ─────────────────────────

create table if not exists public.phases (
    id            int primary key,
    title         text not null,          -- z. B. "Phase 1: Level 1–20"
    subtitle      text not null,          -- z. B. "The Noob Phase"
    goal          text not null,          -- Expeditions-Ziel
    reward_title  text not null,          -- Titel der Belohnung
    level_from    int  not null,
    level_to      int  not null,
    check (level_from <= level_to)
);

create table if not exists public.quests (
    level        int primary key check (level between 1 and 100),
    phase_id     int  not null references public.phases(id),
    name         text not null,
    description  text not null
);

create table if not exists public.profiles (
    id               uuid primary key references auth.users(id) on delete cascade,
    display_name     text,
    player_name      text,
    age              int check (age is null or age between 1 and 130),
    starthilfe       boolean not null default false,
    hardcore         boolean not null default false,
    game_started_at  timestamptz,
    notes            text not null default '',
    created_at       timestamptz not null default now()
);

-- Rolle (nachträglich ergänzt, damit das Skript auch auf bestehenden Datenbanken läuft)
alter table public.profiles add column if not exists role text not null default 'spieler';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('gamemaster', 'spieler'));

-- Kontobereich (nachträglich ergänzt): Geburtsdatum statt Alter, Profilbild, Sichtbarkeit
--   birthday     daraus rechnet die Seite das Alter aus (die alte Spalte age bleibt nur als Rückfall)
--   avatar_url   Pfad im Bucket "avatars", immer im eigenen Ordner <user-id>/…
--   show_avatar  Mitspieler dürfen das Profilbild sehen
--   visible      Mitspieler (auch Gamemaster) sehen einen im Dashboard, Scoreboard und in der Aktivität
alter table public.profiles add column if not exists birthday    date;
alter table public.profiles add column if not exists avatar_url  text;
alter table public.profiles add column if not exists show_avatar boolean not null default true;
alter table public.profiles add column if not exists visible     boolean not null default true;
alter table public.profiles drop constraint if exists profiles_birthday_check;
alter table public.profiles add constraint profiles_birthday_check check (birthday is null or birthday >= date '1900-01-01');
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check check (avatar_url is null or avatar_url like id::text || '/%');

create table if not exists public.quest_progress (
    user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
    level         int  not null references public.quests(level),
    completed_at  timestamptz not null default now(),
    before_start  boolean not null default false,  -- per Starthilfe vor Spielbeginn markiert
    note          text,
    primary key (user_id, level)
);

-- ───────────────────────── Zugriffsregeln (RLS) ─────────────────────────

alter table public.phases         enable row level security;
alter table public.quests         enable row level security;
alter table public.profiles       enable row level security;
alter table public.quest_progress enable row level security;

-- Tabellenrechte für die Website-Schnittstelle (Data API). Neuere Supabase-Projekte vergeben
-- diese nicht mehr automatisch; ohne sie meldet die Seite "permission denied for table …".
-- Welche Zeilen jemand sieht, regeln danach die Policies darunter.
revoke all on public.phases, public.quests, public.profiles, public.quest_progress from anon;
grant select on public.phases, public.quests to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.quest_progress to authenticated;
-- Die Gamemaster-Funktion arbeitet mit dem service_role-Schlüssel (umgeht RLS, braucht aber Tabellenrechte)
grant select, insert, update, delete on public.phases, public.quests, public.profiles, public.quest_progress to service_role;

-- Phasen & Quests: nur für angemeldete Spieler lesbar, ändern nur über den SQL Editor
drop policy if exists "phases lesen" on public.phases;
create policy "phases lesen" on public.phases for select to authenticated using (true);
drop policy if exists "quests lesen" on public.quests;
create policy "quests lesen" on public.quests for select to authenticated using (true);

-- Profil: jeder nur sein eigenes
drop policy if exists "profil lesen" on public.profiles;
create policy "profil lesen" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "profil anlegen" on public.profiles;
create policy "profil anlegen" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profil ändern" on public.profiles;
create policy "profil ändern" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Fortschritt: jeder nur seinen eigenen
drop policy if exists "fortschritt lesen" on public.quest_progress;
create policy "fortschritt lesen" on public.quest_progress for select to authenticated using (user_id = auth.uid());
drop policy if exists "fortschritt eintragen" on public.quest_progress;
create policy "fortschritt eintragen" on public.quest_progress for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "fortschritt ändern" on public.quest_progress;
create policy "fortschritt ändern" on public.quest_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "fortschritt löschen" on public.quest_progress;
create policy "fortschritt löschen" on public.quest_progress for delete to authenticated using (user_id = auth.uid());

-- ───────────────────────── Automatik ─────────────────────────

-- Neues Benutzerkonto → leeres Spielerprofil
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (id, display_name)
    values (new.id, nullif(trim(new.raw_user_meta_data->>'display_name'), ''))
    on conflict (id) do nothing;
    return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
    for each row execute function public.handle_new_user();

-- Rolle: angemeldete Spieler können sie weder beim Anlegen noch später selbst setzen
create or replace function public.protect_role()
returns trigger language plpgsql set search_path = public as $$
begin
    if current_user in ('authenticated', 'anon') then
        if tg_op = 'INSERT' then
            new.role := 'spieler';
        elsif new.role is distinct from old.role then
            raise exception 'Die Rolle kann nur der Gamemaster ändern.' using errcode = 'P0001';
        end if;
    end if;
    return new;
end $$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before insert or update on public.profiles
    for each row execute function public.protect_role();

-- Grundregeln sind nach Spielbeginn fest, der Spielbeginn selbst auch
create or replace function public.lock_rules_after_start()
returns trigger language plpgsql set search_path = public as $$
begin
    if old.game_started_at is not null and (
        new.starthilfe is distinct from old.starthilfe or
        new.hardcore   is distinct from old.hardcore or
        new.game_started_at is distinct from old.game_started_at
    ) then
        raise exception 'Die Grundregeln sind seit Spielbeginn festgelegt.' using errcode = 'P0001';
    end if;
    return new;
end $$;

drop trigger if exists profiles_lock_rules on public.profiles;
create trigger profiles_lock_rules before update on public.profiles
    for each row execute function public.lock_rules_after_start();

-- Quest-Abschluss prüfen (Starthilfe, Hardcore Mode, Level 100)
create or replace function public.check_quest_progress()
returns trigger language plpgsql set search_path = public as $$
declare
    p public.profiles;
    done_before int;
begin
    -- Nachträglich ändern darf man nur die Notiz
    if tg_op = 'UPDATE' then
        if new.level <> old.level or new.before_start <> old.before_start or new.user_id <> old.user_id then
            raise exception 'Nur die Notiz einer Quest kann geändert werden.' using errcode = 'P0001';
        end if;
        return new;
    end if;

    select * into p from public.profiles where id = new.user_id;
    if p.id is null then
        raise exception 'Kein Spielerprofil gefunden.' using errcode = 'P0001';
    end if;

    if new.before_start then
        if not p.starthilfe or p.game_started_at is not null then
            raise exception 'Bereits erledigte Quests können nur mit Starthilfe vor Spielbeginn markiert werden.' using errcode = 'P0001';
        end if;
    elsif p.game_started_at is null then
        raise exception 'Das Spiel hat noch nicht begonnen.' using errcode = 'P0001';
    end if;

    select count(*) into done_before from public.quest_progress
        where user_id = new.user_id and level < new.level;

    if new.level = 100 and done_before < 99 then
        raise exception 'Level 100 kann erst nach Abschluss aller vorherigen Level erreicht werden.' using errcode = 'P0001';
    end if;

    if p.hardcore and not new.before_start and done_before < new.level - 1 then
        raise exception 'Hardcore Mode: Erst alle Quests bis Level % abschließen.', new.level - 1 using errcode = 'P0001';
    end if;

    return new;
end $$;

drop trigger if exists quest_progress_check on public.quest_progress;
create trigger quest_progress_check before insert or update on public.quest_progress
    for each row execute function public.check_quest_progress();

-- ───────────────────────── Öffentliche Zahlen ─────────────────────────

-- Für die Startseite ohne Login und den Keepalive-Job: nur Summen, keine Namen
create or replace function public.get_public_stats()
returns table (players bigint, quests_done bigint, legends bigint)
language sql stable security definer set search_path = public as $$
    select
        (select count(*) from public.profiles where game_started_at is not null),
        (select count(*) from public.quest_progress),
        (select count(*) from public.quest_progress where level = 100);
$$;

revoke all on function public.get_public_stats() from public;
grant execute on function public.get_public_stats() to anon, authenticated;

-- ───────────────────────── Start-Dashboard ─────────────────────────

-- Mitspieler & Scoreboard. Jeder sieht sich selbst und alle, die "visible" eingeschaltet haben.
-- Ausgeblendete Spieler fehlen hier für alle anderen, auch für Gamemaster (die Kontenverwaltung
-- auf gamemaster.html listet weiterhin alle Konten). Das Profilbild nur, wenn "show_avatar" an ist.
-- Geburtsdatum und Alter verlassen die Datenbank nicht, nur "hat heute Geburtstag".
drop function if exists public.get_mitspieler();
create or replace function public.get_mitspieler()
returns table (
    id                 uuid,
    name               text,
    is_me              boolean,
    role               text,
    level              int,
    title              text,         -- höchster freigeschalteter Titel
    avatar_url         text,
    hardcore           boolean,
    started            boolean,
    visible            boolean,
    quests_7d          int,          -- in den letzten 7 Tagen abgeschlossen
    last_level         int,          -- zuletzt abgeschlossene Quest (ohne Starthilfe)
    last_quest         text,
    last_completed_at  timestamptz,
    birthday_today     boolean
)
language sql stable security definer set search_path = public as $$
    with prog as (
        select user_id, count(*)::int as level,
               count(*) filter (where not before_start and completed_at > now() - interval '7 days')::int as quests_7d
        from public.quest_progress group by user_id
    ), last as (
        select distinct on (qp.user_id) qp.user_id, qp.level, q.name, qp.completed_at
        from public.quest_progress qp join public.quests q on q.level = qp.level
        where not qp.before_start
        order by qp.user_id, qp.completed_at desc, qp.level desc
    ), phase_size as (
        select phase_id, count(*) as n from public.quests group by phase_id
    ), titles as (
        select distinct on (x.user_id) x.user_id, x.reward_title
        from (
            select qp.user_id, ph.id as phase_id, ph.reward_title
            from public.quest_progress qp
            join public.quests q on q.level = qp.level
            join public.phases ph on ph.id = q.phase_id
            join phase_size s on s.phase_id = ph.id
            group by qp.user_id, ph.id, ph.reward_title, s.n
            having count(*) = s.n
        ) x
        order by x.user_id, x.phase_id desc
    )
    select p.id,
           coalesce(nullif(trim(p.player_name), ''), nullif(trim(p.display_name), ''), 'Spieler:in'),
           p.id = auth.uid(),
           p.role,
           coalesce(pr.level, 0),
           t.reward_title,
           case when p.show_avatar or p.id = auth.uid() then p.avatar_url end,
           p.hardcore,
           p.game_started_at is not null,
           p.visible,
           coalesce(pr.quests_7d, 0),
           l.level, l.name, l.completed_at,
           coalesce(to_char(p.birthday, 'MM-DD') = to_char(now() at time zone 'Europe/Berlin', 'MM-DD'), false)
    from public.profiles p
    left join prog   pr on pr.user_id = p.id
    left join last   l  on l.user_id  = p.id
    left join titles t  on t.user_id  = p.id
    where auth.uid() is not null and (p.visible or p.id = auth.uid())
    order by coalesce(pr.level, 0) desc, l.completed_at asc nulls last, p.created_at;
$$;

-- Letzte Quest-Abschlüsse aller sichtbaren Spieler (ohne Starthilfe-Quests)
drop function if exists public.get_aktivitaet(int);
create or replace function public.get_aktivitaet(max_rows int default 15)
returns table (user_id uuid, level int, quest text, completed_at timestamptz)
language sql stable security definer set search_path = public as $$
    select qp.user_id, qp.level, q.name, qp.completed_at
    from public.quest_progress qp
    join public.quests q on q.level = qp.level
    join public.profiles p on p.id = qp.user_id
    where auth.uid() is not null and not qp.before_start and (p.visible or p.id = auth.uid())
    order by qp.completed_at desc
    limit least(greatest(coalesce(max_rows, 15), 1), 50);
$$;

revoke all on function public.get_mitspieler() from public;
revoke all on function public.get_aktivitaet(int) from public;
grant execute on function public.get_mitspieler() to authenticated;
grant execute on function public.get_aktivitaet(int) to authenticated;

-- ───────────────────────── Profilbilder (Storage) ─────────────────────────

-- Privater Bucket, max. 1 MB pro Bild (die Seite verkleinert vorher auf 400×400 px JPEG)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Darf der angemeldete Spieler dieses Bild sehen? (eigenes immer, fremdes nur mit show_avatar + visible)
create or replace function public.avatar_visible(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.profiles p
        where p.avatar_url = object_name
          and (p.id = auth.uid() or (p.show_avatar and p.visible))
    );
$$;
revoke all on function public.avatar_visible(text) from public;
grant execute on function public.avatar_visible(text) to authenticated;

-- Hochladen, ändern, löschen nur im eigenen Ordner <user-id>/
drop policy if exists "avatar lesen" on storage.objects;
create policy "avatar lesen" on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.avatar_visible(name)));
drop policy if exists "avatar hochladen" on storage.objects;
create policy "avatar hochladen" on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar ändern" on storage.objects;
create policy "avatar ändern" on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar löschen" on storage.objects;
create policy "avatar löschen" on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
