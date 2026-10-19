// The Real World – Edge Function "gamemaster": Spieler:innen verwalten (nur für Gamemaster)
//
// Läuft im Core-Projekt (travelbase), in dem auch TravelBase liegt. Konten sind dort global:
// Gamemaster = Rolle admin in der App "questlog" (overall_app_access) oder globaler Admin.
// Spieler:in = Rolle member. "Entfernen" nimmt nur den Questlog-Zugang samt Spielstand weg,
// das Konto selbst bleibt für die anderen Apps bestehen. E-Mail und Passwort eines Kontos
// ändern nur globale Admins, weil sie für alle Apps gelten.
//
// Veröffentlichen: Supabase → Edge Functions → "Deploy a new function" → "Via Editor",
// Name "gamemaster", diesen Code einfügen, Deploy. Danach in den Function-Einstellungen
// "Verify JWT with legacy secret" ausschalten – die Funktion prüft die Anmeldung selbst.
//
// Der service_role-Schlüssel stellt Supabase der Funktion automatisch bereit; er verlässt
// den Server nie. Passwörter speichert Supabase nur als Hash, deshalb kann man sie nicht
// anzeigen, sondern nur neu setzen.
//
// Aufruf (POST, JSON): { action: "list" | "create" | "update" | "delete", ... }
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['gamemaster', 'spieler'];
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

class Fail extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
// deno-lint-ignore no-explicit-any
const check = ({ data, error }: { data: any; error: { message: string } | null }): any => {
    if (error) throw new Fail(error.message);
    return data;
};
const text = (v: unknown, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validEmail(v: unknown) {
    const e = text(v, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Fail('Bitte eine gültige E-Mail-Adresse angeben.');
    return e;
}
function validPassword(v: unknown) {
    if (typeof v !== 'string' || v.length < 8) throw new Fail('Das Passwort braucht mindestens 8 Zeichen.');
    return v;
}
function validRole(v: unknown) {
    if (!ROLES.includes(v as string)) throw new Fail('Unbekannte Rolle.');
    return v as string;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const APP = 'questlog';
const toAppRole = (role: string) => (role === 'gamemaster' ? 'admin' : 'member');

async function allUsers() {
    // deno-lint-ignore no-explicit-any
    const users: any[] = [];
    for (let page = 1; ; page++) {
        const { users: batch } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }));
        users.push(...batch);
        if (batch.length < 1000) break;
    }
    return users;
}

async function appRole(id: string): Promise<string | null> {
    return check(await admin.rpc('overall_user_app_role', { p_user: id, p_app: APP }));
}

async function isGlobalAdmin(id: string) {
    const p = check(await admin.from('overall_profiles').select('role').eq('id', id).maybeSingle());
    return p?.role === 'admin';
}

async function listAccounts() {
    const players = check(await admin.from('questlog_players').select('id, player_name, visible, share_questlog, starthilfe, hardcore, game_started_at')) ?? [];
    const access = check(await admin.from('overall_app_access').select('user_id, role').eq('app_id', APP)) ?? [];
    const admins = check(await admin.from('overall_profiles').select('id').eq('role', 'admin')) ?? [];
    const ids = new Set<string>([...players.map((p: { id: string }) => p.id), ...access.map((a: { user_id: string }) => a.user_id)]);
    const profiles = check(await admin.from('overall_profiles').select('id, display_name, birthday').in('id', [...ids])) ?? [];
    const progress = check(await admin.from('questlog_quest_progress').select('user_id')) ?? [];
    // deno-lint-ignore no-explicit-any
    const byId = (rows: any[]) => new Map<string, any>(rows.map((r) => [r.id ?? r.user_id, r]));
    const pl = byId(players), pr = byId(profiles), ac = byId(access), ad = new Set(admins.map((a: { id: string }) => a.id));
    const levels = new Map<string, number>();
    for (const r of progress) levels.set(r.user_id, (levels.get(r.user_id) ?? 0) + 1);
    return (await allUsers()).filter((u) => ids.has(u.id) && (ac.has(u.id) || ad.has(u.id))).map((u) => {
        const p = pl.get(u.id) ?? {}, o = pr.get(u.id) ?? {};
        return {
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at ?? null,
            email_confirmed_at: u.email_confirmed_at ?? null,
            role: ad.has(u.id) || ac.get(u.id)?.role === 'admin' ? 'gamemaster' : 'spieler',
            global_admin: ad.has(u.id),
            display_name: o.display_name ?? null,
            player_name: p.player_name ?? null,
            birthday: o.birthday ?? null,
            visible: p.visible ?? true,
            share_questlog: !!p.share_questlog,
            starthilfe: !!p.starthilfe,
            hardcore: !!p.hardcore,
            game_started_at: p.game_started_at ?? null,
            level: levels.get(u.id) ?? 0,
        };
    }).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// Neues Konto anlegen oder, wenn es die E-Mail schon gibt (z. B. aus TravelBase), dem Konto Questlog-Zugang geben
async function createAccount(meIsAdmin: boolean, b: Record<string, unknown>) {
    const email = validEmail(b.email), role = validRole(b.role ?? 'spieler');
    const display_name = text(b.display_name, 40) || null;
    let id = (await allUsers()).find((u) => (u.email ?? '').toLowerCase() === email)?.id as string | undefined;
    if (!id) {
        const password = validPassword(b.password);
        const { user } = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name } }));
        id = user!.id;
        // Das globale Profil legt der Datenbank-Trigger an; den Namen hier sicher setzen
        if (display_name) check(await admin.from('overall_profiles').update({ display_name }).eq('id', id));
    } else if (role === 'gamemaster' && !meIsAdmin) {
        throw new Fail('Bestehende Konten zum Gamemaster machen dürfen nur Admins.');
    }
    // Zugang zur App; der Spielstand entsteht per Datenbank-Trigger
    check(await admin.from('overall_app_access').upsert({ user_id: id, app_id: APP, role: toAppRole(role) }));
    return { id };
}

async function updateAccount(meId: string, meIsAdmin: boolean, b: Record<string, unknown>) {
    const id = text(b.id, 64);
    if (!id) throw new Fail('Konto fehlt.');
    if (!(await appRole(id))) throw new Fail('Dieses Konto hat keinen Questlog-Zugang.');
    const auth: Record<string, unknown> = {};
    if (b.email !== undefined) { auth.email = validEmail(b.email); auth.email_confirm = true; }
    if (b.password) auth.password = validPassword(b.password);
    if (Object.keys(auth).length && !meIsAdmin && id !== meId)
        throw new Fail('E-Mail und Passwort gelten für alle Apps und können nur von Admins geändert werden.');
    const global: Record<string, unknown> = {}, game: Record<string, unknown> = {};
    let access: string | null = null;
    if (b.role !== undefined) {
        const role = validRole(b.role);
        if (id === meId && role !== 'gamemaster') throw new Fail('Du kannst dir die Gamemaster-Rolle nicht selbst nehmen.');
        if (await isGlobalAdmin(id)) {
            if (role !== 'gamemaster') throw new Fail('Globale Admins sind immer Gamemaster.');
        } else access = toAppRole(role);
    }
    if (b.display_name !== undefined) global.display_name = text(b.display_name, 40) || null;
    if (b.player_name !== undefined) game.player_name = text(b.player_name, 40) || null;
    if (b.birthday !== undefined) {
        const d = b.birthday === null || b.birthday === '' ? null : String(b.birthday);
        if (d !== null && !(/^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '1900-01-01' && d <= new Date().toISOString().slice(0, 10))) throw new Fail('Das Geburtsdatum ist ungültig.');
        global.birthday = d;
    }
    if (Object.keys(auth).length) check(await admin.auth.admin.updateUserById(id, auth));
    if (Object.keys(global).length) check(await admin.from('overall_profiles').update(global).eq('id', id));
    if (Object.keys(game).length) check(await admin.from('questlog_players').update(game).eq('id', id));
    if (access) check(await admin.from('overall_app_access').upsert({ user_id: id, app_id: APP, role: access }));
    return { id };
}

// Aus dem Questlog entfernen: Zugang und Spielstand weg, das Konto bleibt für die anderen Apps
async function removePlayer(meId: string, b: Record<string, unknown>) {
    const id = text(b.id, 64);
    if (!id) throw new Fail('Konto fehlt.');
    if (id === meId) throw new Fail('Dich selbst kannst du hier nicht entfernen.');
    if (await isGlobalAdmin(id)) throw new Fail('Globale Admins können nicht aus dem Questlog entfernt werden.');
    check(await admin.from('overall_app_access').delete().eq('user_id', id).eq('app_id', APP));
    check(await admin.from('questlog_players').delete().eq('id', id));
    return { id };
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Nur POST.' }, 405);
    try {
        // Wer ruft auf? Nur angemeldete Gamemaster dürfen weiter.
        const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
        const { data: { user } } = await admin.auth.getUser(token);
        if (!user) throw new Fail('Bitte zuerst anmelden.', 401);
        if ((await appRole(user.id)) !== 'admin') throw new Fail('Dieser Bereich ist nur für den Gamemaster.', 403);
        const meIsAdmin = await isGlobalAdmin(user.id);

        const body = await req.json().catch(() => ({}));
        switch (body.action) {
            case 'list': return json({ me: user.id, users: await listAccounts() });
            case 'create': return json(await createAccount(meIsAdmin, body));
            case 'update': return json(await updateAccount(user.id, meIsAdmin, body));
            case 'delete': return json(await removePlayer(user.id, body));
            default: throw new Fail('Unbekannte Aktion.');
        }
    } catch (e) {
        const status = e instanceof Fail ? e.status : 500;
        return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
});
