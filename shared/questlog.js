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
                sb.from('quest_progress').select('level, completed_at, before_start, note').then(check)
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
    async function startGame({ player_name, age, starthilfe, hardcore, alreadyDone }) {
        await saveProfile({ player_name, age, starthilfe, hardcore });
        if (starthilfe && alreadyDone.length) {
            check(await sb.from('quest_progress').insert(alreadyDone.map(level => ({ level, before_start: true }))));
        }
        return saveProfile({ game_started_at: new Date().toISOString() });
    }

    async function completeQuest(level) {
        needSb();
        return check(await sb.from('quest_progress').insert({ level }).select('level, completed_at, before_start, note').single());
    }

    async function undoQuest(level) {
        needSb();
        check(await sb.from('quest_progress').delete().eq('level', level));
    }

    async function saveQuestNote(level, note) {
        needSb();
        check(await sb.from('quest_progress').update({ note }).eq('level', level));
    }

    async function signIn(email, password) {
        needSb();
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
    }

    /* Registrierung: Supabase schickt eine Bestätigungs-Mail (sofern im Dashboard aktiviert).
       Rückgabe true = sofort angemeldet, false = erst E-Mail bestätigen. */
    async function signUp(email, password, displayName) {
        needSb();
        const emailRedirectTo = location.origin + location.pathname.replace(/[^/]*$/, '');
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: displayName }, emailRedirectTo } });
        if (error) throw error;
        return !!data.session;
    }

    async function signOut() {
        clearCache();
        if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
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

    /* Deutsche Fehlermeldungen für die häufigsten Fälle */
    function errorText(e) {
        const m = String(e && (e.message || e));
        if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort ist falsch.';
        if (/email not confirmed/i.test(m)) return 'Diese E-Mail ist noch nicht bestätigt. Schau in dein Postfach.';
        if (/already registered|already been registered/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto.';
        if (/password should be at least|weak password/i.test(m)) return 'Das Passwort ist zu kurz oder zu einfach (mind. 8 Zeichen empfohlen).';
        if (/permission denied for table/i.test(m)) return 'Die Datenbank verweigert den Zugriff. Bitte supabase/schema.sql im Supabase SQL Editor erneut ausführen.';
        if (/rate limit|too many/i.test(m)) return 'Zu viele Versuche – bitte kurz warten.';
        if (isNetErr(e)) return 'Keine Verbindung zum Server. Bist du online?';
        return m;
    }

    window.RQ = { sb, configured, cacheGet, cacheSet, isNetErr, getSession, publicStats, loadGame, saveProfile, startGame,
        completeQuest, undoQuest, saveQuestNote, signIn, signUp, signOut, resetPassword, updatePassword, clearCache, errorText,
        onAuth: cb => sb && sb.auth.onAuthStateChange((ev, session) => cb(ev, session)) };
})();
