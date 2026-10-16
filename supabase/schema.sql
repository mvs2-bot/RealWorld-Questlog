-- The Real World – Quest Log: Datenbank-Schema für Supabase
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen.
-- Danach die Quest-Texte mit dem Seed-Skript einspielen (liegt NICHT in diesem Repo).
--
-- Tabellen
--   phases          6 Phasen (Noob Phase … The final Step) inkl. Belohnungs-Titel
--   quests          100 Quests, eine pro Level
--   profiles        ein Spieler pro Benutzerkonto (Spielername, Grundregeln, Notizen)
--   quest_progress  welche Quests ein Spieler wann abgeschlossen hat
--
-- Spielregeln, die die Datenbank selbst durchsetzt
--   - Grundregeln (Starthilfe, Hardcore Mode) sind nach Spielbeginn fest.
--   - Starthilfe: nur vor Spielbeginn dürfen Quests als "schon erledigt" markiert werden.
--   - Hardcore Mode: Quest n erst, wenn 1 … n-1 abgeschlossen sind.
--   - Level 100 erst, wenn alle Level 1 … 99 abgeschlossen sind (gilt immer).

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
