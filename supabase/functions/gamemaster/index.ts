// The Real World – Edge Function "gamemaster": Konten verwalten (nur für die Rolle Gamemaster)
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

async function listAccounts() {
    // deno-lint-ignore no-explicit-any
    const users: any[] = [];
    for (let page = 1; ; page++) {
        const { users: batch } = check(await admin.auth.admin.listUsers({ page, perPage: 1000 }));
        users.push(...batch);
        if (batch.length < 1000) break;
    }
    const profiles = check(await admin.from('profiles').select('id, role, display_name, player_name, age, starthilfe, hardcore, game_started_at')) ?? [];
    const progress = check(await admin.from('quest_progress').select('user_id')) ?? [];
    // deno-lint-ignore no-explicit-any
    const byId = new Map<string, any>(profiles.map((p: any) => [p.id, p]));
    const levels = new Map<string, number>();
    for (const r of progress) levels.set(r.user_id, (levels.get(r.user_id) ?? 0) + 1);
    return users.map((u) => {
        const p = byId.get(u.id) ?? {};
        return {
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at ?? null,
            email_confirmed_at: u.email_confirmed_at ?? null,
            role: p.role ?? 'spieler',
            display_name: p.display_name ?? null,
            player_name: p.player_name ?? null,
            age: p.age ?? null,
            starthilfe: !!p.starthilfe,
            hardcore: !!p.hardcore,
            game_started_at: p.game_started_at ?? null,
            level: levels.get(u.id) ?? 0,
        };
    }).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function createAccount(b: Record<string, unknown>) {
    const email = validEmail(b.email), password = validPassword(b.password), role = validRole(b.role ?? 'spieler');
    const display_name = text(b.display_name, 40) || null;
    const { user } = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name } }));
    // Das Profil legt der Datenbank-Trigger an; hier nur noch Rolle und Name sicher setzen
    check(await admin.from('profiles').upsert({ id: user!.id, role, display_name }));
    return { id: user!.id };
}

async function updateAccount(meId: string, b: Record<string, unknown>) {
    const id = text(b.id, 64);
    if (!id) throw new Fail('Konto fehlt.');
    const auth: Record<string, unknown> = {};
    if (b.email !== undefined) { auth.email = validEmail(b.email); auth.email_confirm = true; }
    if (b.password) auth.password = validPassword(b.password);
    const profile: Record<string, unknown> = {};
    if (b.role !== undefined) {
        profile.role = validRole(b.role);
        if (id === meId && profile.role !== 'gamemaster') throw new Fail('Du kannst dir die Gamemaster-Rolle nicht selbst nehmen.');
    }
    if (b.display_name !== undefined) profile.display_name = text(b.display_name, 40) || null;
    if (b.player_name !== undefined) profile.player_name = text(b.player_name, 40) || null;
    if (b.age !== undefined) {
        const age = b.age === null || b.age === '' ? null : Number(b.age);
        if (age !== null && !(Number.isInteger(age) && age >= 1 && age <= 130)) throw new Fail('Das Alter muss zwischen 1 und 130 liegen.');
        profile.age = age;
    }
    if (Object.keys(auth).length) check(await admin.auth.admin.updateUserById(id, auth));
    if (Object.keys(profile).length) check(await admin.from('profiles').update(profile).eq('id', id));
    return { id };
}

async function deleteAccount(meId: string, b: Record<string, unknown>) {
    const id = text(b.id, 64);
    if (!id) throw new Fail('Konto fehlt.');
    if (id === meId) throw new Fail('Dein eigenes Konto kannst du hier nicht löschen.');
    check(await admin.auth.admin.deleteUser(id));
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
        const me = check(await admin.from('profiles').select('role').eq('id', user.id).maybeSingle());
        if (me?.role !== 'gamemaster') throw new Fail('Dieser Bereich ist nur für den Gamemaster.', 403);

        const body = await req.json().catch(() => ({}));
        switch (body.action) {
            case 'list': return json({ me: user.id, users: await listAccounts() });
            case 'create': return json(await createAccount(body));
            case 'update': return json(await updateAccount(user.id, body));
            case 'delete': return json(await deleteAccount(user.id, body));
            default: throw new Fail('Unbekannte Aktion.');
        }
    } catch (e) {
        const status = e instanceof Fail ? e.status : 500;
        return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
});
