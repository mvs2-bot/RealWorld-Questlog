/* The Real World – gemeinsame Logik für Konten, Spielstand & Offline-Zwischenspeicher
   Benötigt vorher: supabase-js (CDN) und shared/config.js */
(function () {
    const cfg = window.RQ_CONFIG || {};
    const configured = !!(cfg.url && cfg.key && !/DEIN-PROJEKT|DEIN-PUBLISHABLE/.test(cfg.url + cfg.key));
    const sb = configured && window.supabase
        ? window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
        : null;

    /* Offline-Zwischenspeicher: zuletzt geladener Spielstand bleibt auf dem Gerät,
       damit das Questlog unterwegs ohne Netz lesbar ist. Wird beim Abmelden gelöscht. */
    const CACHE = 'rq_cache_v1_';
    const cacheGet = k => { try { return JSON.parse(localStorage.getItem(CACHE + k)); } catch (e) { return null; } };
    const cacheSet = (k, v) => { try { localStorage.setItem(CACHE + k, JSON.stringify(v)); } catch (e) {} };
    function clearCache() {
        try { Object.keys(localStorage).filter(k => k.startsWith(CACHE)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    }
    const isNetErr = e => !navigator.onLine || /fetch|network|load failed|timeout/i.test(String(e && (e.message || e)));
    const check = ({ data, error }) => { if (error) throw error; return data; };
    const needSb = () => { if (!sb) throw new Error('Supabase ist noch nicht eingerichtet (shared/config.js).'); };

    async function getSession() {
        if (!sb) return null;
        try { return (await sb.auth.getSession()).data.session; } catch (e) { return null; }
    }

    /* Öffentliche Zahlen für die Startseite (ohne Login) */
    async function publicStats() {
        if (!sb) return cacheGet('stats');
        try {
            const rows = check(await sb.rpc('get_public_stats'));
            const s = rows && rows[0] || null;
            cacheSet('stats', s);
            return s;
        } catch (e) { return cacheGet('stats'); }
    }

    const PROGRESS = 'level, completed_at, before_start, note';

    /* Kompletter Spielstand des angemeldeten Spielers:
       { profile, phases, quests, progress: { [level]: row }, offline } */
    async function loadGame() {
        const session = await getSession();
        if (!session) return null;
        const key = 'game_' + session.user.id;
        try {
            const [profile, phases, quests, progress] = await Promise.all([
                sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(check),
                sb.from('phases').select('*').order('id').then(check),
                sb.from('quests').select('*').order('level').then(check),
                sb.from('quest_progress').select(PROGRESS).eq('user_id', session.user.id).then(check)
            ]);
            const game = { profile, phases, quests, progress: Object.fromEntries(progress.map(p => [p.level, p])), email: session.user.email };
            cacheSet(key, game);
            return { ...game, offline: false };
        } catch (e) {
            const cached = cacheGet(key);
            if (cached && isNetErr(e)) return { ...cached, offline: true };
            throw e;
        }
    }

    async function saveProfile(fields) {
        needSb();
        const session = await getSession();
        return check(await sb.from('profiles').upsert({ id: session.user.id, ...fields }).select().single());
    }

    /* Spielstart: erst die per Starthilfe erledigten Quests eintragen, dann die Regeln festschreiben */
    async function startGame({ player_name, birthday, starthilfe, hardcore, alreadyDone }) {
        await saveProfile({ player_name, birthday, starthilfe, hardcore });
        if (starthilfe && alreadyDone.length) {
            check(await sb.from('quest_progress').insert(alreadyDone.map(level => ({ level, before_start: true }))));
        }
        return saveProfile({ game_started_at: new Date().toISOString() });
    }

    /* Quest-Fortschritt eines Spielers. userId fehlt → der angemeldete Spieler selbst;
       fremde Questlogs darf nur der Gamemaster ändern (prüft die Datenbank). */
    async function uid(userId) { return userId || (await getSession()).user.id; }

    async function completeQuest(level, userId) {
        needSb();
        return check(await sb.from('quest_progress').insert({ level, user_id: await uid(userId) }).select(PROGRESS).single());
    }

    async function undoQuest(level, userId) {
        needSb();
        check(await sb.from('quest_progress').delete().eq('user_id', await uid(userId)).eq('level', level));
    }

    /* Abschlussdatum und/oder Kommentar ändern: fields = { completed_at?, note? } */
    async function updateQuest(level, fields, userId) {
        needSb();
        const rows = check(await sb.from('quest_progress').update(fields).eq('user_id', await uid(userId)).eq('level', level).select(PROGRESS));
        if (!rows || !rows.length) throw new Error('Keine Berechtigung für diese Aktion.');
        return rows[0];
    }

    /* Questlog eines anderen Spielers (nur wenn freigegeben, oder als Gamemaster):
       { owner: { id, name, role, avatar_url, hardcore, starthilfe, game_started_at, visible, share_questlog, can_edit },
         progress: { [level]: row } } – null, wenn man es nicht sehen darf */
    async function loadPlayerLog(userId) {
        needSb();
        const rows = check(await sb.rpc('get_questlog_owner', { owner: userId }));
        const owner = rows && rows[0];
        if (!owner) return null;
        const progress = check(await sb.from('quest_progress').select(PROGRESS).eq('user_id', userId));
        return { owner, progress: Object.fromEntries(progress.map(p => [p.level, p])) };
    }

    async function signIn(email, password) {
        needSb();
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }

    /* Abmelden nur auf diesem Gerät (andere Geräte bleiben angemeldet).
       Wurde die Sitzung schon anderswo beendet, lehnt der Server das Abmelden ab
       und supabase-js behält die alte Sitzung – dann räumen wir sie selbst weg. */
    async function signOut() {
        clearCache();
        if (!sb) return;
        try {
            const { error } = await sb.auth.signOut({ scope: 'local' });
            if (!error) return;
        } catch (e) {}
        try {
            const key = sb.auth.storageKey;
            Object.keys(localStorage).filter(k => k === key || k.startsWith(key + '-')).forEach(k => localStorage.removeItem(k));
        } catch (e) {}
    }

    async function resetPassword(email) {
        needSb();
        const redirectTo = location.origin + location.pathname.replace(/[^/]*$/, '');
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
    }

    async function updatePassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
    }

    /* Gamemaster-Bereich: Konten verwalten über die Edge Function "gamemaster".
       Die prüft selbst, ob der Aufrufer Gamemaster ist; der geheime Schlüssel bleibt in Supabase. */
    async function gm(action, payload = {}) {
        needSb();
        const { data, error } = await sb.functions.invoke('gamemaster', { body: { action, ...payload } });
        if (!error) return data;
        let m = error.message;
        try { const b = await error.context.json(); if (b && b.error) m = b.error; } catch (e) {}
        if (error.name === 'FunctionsFetchError' || error.name === 'FunctionsRelayError' || /requested function was not found/i.test(m))
            m = 'Die Gamemaster-Funktion ist nicht erreichbar. Ist sie in Supabase unter Edge Functions als „gamemaster“ veröffentlicht?';
        throw new Error(m);
    }

    /* ───────── Kontobereich ───────── */

    /* Alter aus dem Geburtsdatum (YYYY-MM-DD), null wenn keins eingetragen ist */
    const pad = n => String(n).padStart(2, '0');
    function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    function ageFrom(birthday) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthday || '');
        if (!m) return null;
        const [y, mo, d] = today().split('-').map(Number);
        const age = y - +m[1] - ((mo < +m[2] || (mo === +m[2] && d < +m[3])) ? 1 : 0);
        return age >= 0 ? age : null;
    }

    /* Profilbilder liegen im privaten Bucket "avatars" unter <user-id>/…, der Pfad steht in profiles.avatar_url.
       Angezeigt werden sie über kurzlebige signierte Links; wer ein Bild sehen darf, prüft Supabase. */
    const AVATARS = 'avatars';
    const signed = {};   /* Pfad → { url, until } */
    async function avatarUrls(paths) {
        paths = [...new Set(paths.filter(Boolean))];
        const now = Date.now(), missing = paths.filter(p => !signed[p] || signed[p].until < now);
        if (sb && missing.length) {
            try {
                const rows = check(await sb.storage.from(AVATARS).createSignedUrls(missing, 3600));
                rows.forEach(r => { if (r.signedUrl) signed[r.path] = { url: r.signedUrl, until: now + 50 * 60 * 1000 }; });
            } catch (e) { /* offline oder Bucket fehlt → ohne Bild */ }
        }
        return Object.fromEntries(paths.filter(p => signed[p]).map(p => [p, signed[p].url]));
    }

    /* Foto quadratisch zuschneiden und auf max. 400 px verkleinern (JPEG), wie bei TravelBase */
    async function shrink(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('Das Bild konnte nicht gelesen werden. Bitte ein JPG oder PNG wählen.')); i.src = url; });
            const s = Math.min(img.naturalWidth, img.naturalHeight), size = Math.min(400, s);
            const c = document.createElement('canvas'); c.width = c.height = size;
            c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
            return await new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('Das Bild konnte nicht verarbeitet werden.')), 'image/jpeg', 0.85));
        } finally { URL.revokeObjectURL(url); }
    }

    /* Neues Profilbild hochladen; gibt das geänderte Profil zurück. Das alte Bild wird danach gelöscht. */
    async function uploadAvatar(file, oldPath) {
        needSb();
        const session = await getSession();
        const blob = await shrink(file);
        const path = `${session.user.id}/avatar-${Date.now()}.jpg`;
        check(await sb.storage.from(AVATARS).upload(path, blob, { contentType: 'image/jpeg' }));
        let profile;
        try { profile = await saveProfile({ avatar_url: path }); }
        catch (e) { sb.storage.from(AVATARS).remove([path]).catch(() => {}); throw e; }
        if (oldPath) sb.storage.from(AVATARS).remove([oldPath]).catch(() => {});
        return profile;
    }

    async function removeAvatar(oldPath) {
        const profile = await saveProfile({ avatar_url: null });
        if (oldPath) sb.storage.from(AVATARS).remove([oldPath]).catch(() => {});
        return profile;
    }

    /* ───────── Start-Dashboard ───────── */

    /* Mitspieler (inkl. einem selbst) als Scoreboard sortiert + letzte Quest-Abschlüsse.
       Liefert { players, activity, offline }; ohne Netz den zuletzt geladenen Stand. */
    async function loadDashboard() {
        needSb();
        const session = await getSession();
        const key = 'dash_' + session.user.id;
        try {
            const [players, activity] = await Promise.all([
                sb.rpc('get_mitspieler').then(check),
                sb.rpc('get_aktivitaet', { max_rows: 12 }).then(check)
            ]);
            const dash = { players: players || [], activity: activity || [] };
            cacheSet(key, dash);
            return { ...dash, offline: false };
        } catch (e) {
            const cached = cacheGet(key);
            if (cached && isNetErr(e)) return { ...cached, offline: true };
            throw e;
        }
    }

    /* Deutsche Fehlermeldungen für die häufigsten Fälle */
    function errorText(e) {
        const m = String(e && (e.message || e));
        if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort ist falsch.';
        if (/email not confirmed/i.test(m)) return 'Diese E-Mail ist noch nicht bestätigt. Schau in dein Postfach.';
        if (/already registered|already been registered/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto.';
        if (/password should be at least|weak password/i.test(m)) return 'Das Passwort ist zu kurz oder zu einfach (mind. 8 Zeichen empfohlen).';
        if (/permission denied for table/i.test(m)) return 'Die Datenbank verweigert den Zugriff. Bitte supabase/schema.sql im Supabase SQL Editor erneut ausführen.';
        if (/could not find the function|bucket not found|column .*(birthday|show_avatar|avatar_url|visible|share_questlog)|(birthday|show_avatar|avatar_url|visible|share_questlog).* column/i.test(m))
            return 'Für diese Funktion fehlt noch die Datenbank-Erweiterung. Bitte supabase/schema.sql im Supabase SQL Editor erneut ausführen.';
        if (/row-level security/i.test(m)) return 'Keine Berechtigung für diese Aktion.';
        if (/payload too large|exceeded the maximum|too large/i.test(m)) return 'Das Bild ist zu groß.';
        if (/rate limit|too many/i.test(m)) return 'Zu viele Versuche – bitte kurz warten.';
        if (isNetErr(e)) return 'Keine Verbindung zum Server. Bist du online?';
        return m;
    }

    window.RQ = { sb, configured, cacheGet, cacheSet, isNetErr, getSession, publicStats, loadGame, saveProfile, startGame,
        completeQuest, undoQuest, updateQuest, loadPlayerLog, signIn, signOut, resetPassword, updatePassword, clearCache, errorText, gm,
        today, ageFrom, avatarUrls, uploadAvatar, removeAvatar, loadDashboard,
        onAuth: cb => sb && sb.auth.onAuthStateChange((ev, session) => cb(ev, session)) };
})();
