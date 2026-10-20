/* Gemeinsames Konto-Modul für alle Seiten im Supabase-Core-Projekt (TravelBase, Questlog, …)
   Bearbeitet das globale Profil in overall_profiles: Anzeigename, Profilbild, Geburtsdatum,
   Geschlecht, Größe, Gewicht – und das Passwort (Supabase Auth). Alles gilt für alle Apps.

   Original liegt im Repo supabase-core unter shared/overall-account.js. Die Webseiten-Repos haben
   eine identische Kopie; Änderungen bitte dort machen und in alle Seiten kopieren.

   Benutzung (supabase-js muss schon geladen sein):
     OverallAccount.openSettings({ sb, onChange })   Kontoeinstellungen als Dialog
     OverallAccount.openPassword({ sb, redirectTo }) Passwort ändern / Link per E-Mail
     OverallAccount.mountSettings(el, { sb, onChange })   dasselbe direkt in ein Element (Kontoseite)
     OverallAccount.mountPassword(el, { sb, redirectTo }) dasselbe direkt in ein Element
     OverallAccount.mountEmail(el, { sb, redirectTo })    E-Mail-Adresse ändern (mit Bestätigungslink)
     OverallAccount.loadPhoto(sb, path)              Profilbild als data:-URL (für Kopfzeilen)
   onChange(profile) wird nach jedem Speichern mit dem neuen Profil aufgerufen.
   Aussehen über die CSS-Variablen der Seite (--card, --line, --ink, --text, --mute, --p1, --bg, --hover, --danger). */
(function () {
    const BUCKET = 'avatars';
    const FIELDS = 'display_name, avatar_path, birthday, gender, height_cm, weight_kg';
    const GENDERS = { '': '–', female: 'weiblich', male: 'männlich', diverse: 'divers' };
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const check = ({ data, error }) => { if (error) throw error; return data; };
    const pad = n => String(n).padStart(2, '0');
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

    function errText(e) {
        const m = String(e && (e.message || e));
        if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort ist falsch.';
        if (/password should be at least|weak password/i.test(m)) return 'Das Passwort ist zu kurz oder zu einfach (mind. 8 Zeichen).';
        if (/same.*password|different from the old/i.test(m)) return 'Das neue Passwort muss sich vom alten unterscheiden.';
        if (/height_cm/i.test(m)) return 'Die Größe muss zwischen 50 und 250 cm liegen.';
        if (/weight_kg/i.test(m)) return 'Das Gewicht muss zwischen 20 und 300 kg liegen.';
        if (/birthday/i.test(m)) return 'Das Geburtsdatum ist ungültig.';
        if (/payload too large|exceeded the maximum|too large/i.test(m)) return 'Das Bild ist zu groß.';
        if (/row-level security|permission denied/i.test(m)) return 'Keine Berechtigung für diese Aktion.';
        if (/rate limit|too many/i.test(m)) return 'Zu viele Versuche – bitte kurz warten.';
        if (!navigator.onLine || /fetch|network|load failed/i.test(m)) return 'Keine Verbindung zum Server. Bist du online?';
        return m;
    }
    function msg(el, text, ok) { el.textContent = text; el.className = 'oa-msg' + (ok ? ' ok' : ''); el.hidden = !text; }

    /* ---------- Daten ---------- */
    async function currentUser(sb) {
        const { data } = await sb.auth.getSession();
        if (!data.session) throw new Error('Bitte zuerst anmelden.');
        return { id: data.session.user.id, email: data.session.user.email };
    }

    async function loadProfile(sb) {
        const user = await currentUser(sb);
        const row = check(await sb.from('overall_profiles').select(FIELDS).eq('id', user.id).maybeSingle());
        return { user, profile: row || {} };
    }

    async function saveProfile(sb, user, fields) {
        return check(await sb.from('overall_profiles').update(fields).eq('id', user.id).select(FIELDS).single());
    }

    async function loadPhoto(sb, path) {
        if (!path) return null;
        const blob = check(await sb.storage.from(BUCKET).download(path));
        return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(blob); });
    }

    /* Foto quadratisch zuschneiden und auf max. 400 px verkleinern (JPEG) */
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

    async function uploadPhoto(sb, user, profile, file) {
        const blob = await shrink(file);
        const path = `${user.id}/avatar-${Date.now()}.jpg`;
        check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' }));
        let saved;
        try { saved = await saveProfile(sb, user, { avatar_path: path }); }
        catch (e) { sb.storage.from(BUCKET).remove([path]).catch(() => {}); throw e; }
        if (profile.avatar_path) sb.storage.from(BUCKET).remove([profile.avatar_path]).catch(() => {});
        return saved;
    }

    async function removePhoto(sb, user, profile) {
        const saved = await saveProfile(sb, user, { avatar_path: null });
        if (profile.avatar_path) sb.storage.from(BUCKET).remove([profile.avatar_path]).catch(() => {});
        return saved;
    }

    /* ---------- Dialog ---------- */
    let modal = null;
    function openModal(html) {
        closeModal();
        modal = document.createElement('div');
        modal.className = 'oa-modal';
        modal.innerHTML = `<div class="oa-dialog" role="dialog" aria-modal="true">${html}</div>`;
        modal.onclick = e => { if (e.target === modal || e.target.closest('.oa-close')) closeModal(); };
        document.body.appendChild(modal);
        return modal.querySelector('.oa-dialog');
    }
    function closeModal() { if (modal) { modal.remove(); modal = null; } }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    /* Im Dialog mit Überschrift und ✕, auf der Kontoseite ohne (die Seite hat eigene Überschriften) */
    const head = (d, title) => d.classList.contains('oa-inline') ? '' : `<h2>${title} <button class="oa-close" type="button" aria-label="Schließen">✕</button></h2>`;
    function mount(el) {
        el.classList.add('oa-dialog', 'oa-inline');
        return el;
    }

    const openSettings = (opts = {}) => fillSettings(openModal(''), opts);
    const mountSettings = (el, opts = {}) => fillSettings(mount(el), opts);
    async function fillSettings(d, { sb, onChange } = {}) {
        d.innerHTML = head(d, '⚙️ Kontoeinstellungen') + '<p class="oa-note">⏳ Lädt …</p>';
        let user, profile, photo = null;
        try {
            ({ user, profile } = await loadProfile(sb));
            photo = await loadPhoto(sb, profile.avatar_path).catch(() => null);
        } catch (e) { d.querySelector('.oa-note').textContent = errText(e); return; }
        if (!d.isConnected) return;   /* inzwischen geschlossen */

        const ava = () => photo ? `<img src="${photo}" alt="">` : '👤';
        d.innerHTML = `
            ${head(d, '⚙️ Kontoeinstellungen')}
            <p class="oa-note">Gilt für alle Apps, in denen du dich mit diesem Konto anmeldest.</p>
            <div class="oa-photo">
                <span class="oa-ava" id="oaAva">${ava()}</span>
                <div class="oa-photo-actions">
                    <button class="oa-ghost" type="button" id="oaPick">📷 Foto wählen</button>
                    <button class="oa-link" type="button" id="oaRemove"${profile.avatar_path ? '' : ' hidden'}>Foto entfernen</button>
                    <input type="file" id="oaFile" accept="image/*" hidden>
                </div>
            </div>
            <form id="oaForm">
                <label>Anzeigename<input type="text" id="oaName" maxlength="80" autocomplete="nickname" value="${esc(profile.display_name)}" placeholder="${esc(user.email.split('@')[0])}"></label>
                <label>E-Mail<input type="email" value="${esc(user.email)}" disabled></label>
                <div class="oa-grid">
                    <label>Geburtsdatum<input type="date" id="oaBirthday" min="1900-01-01" max="${today()}" value="${esc(profile.birthday)}"></label>
                    <label>Geschlecht<select id="oaGender">${Object.entries(GENDERS).map(([k, t]) => `<option value="${k}"${(profile.gender || '') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
                    <label>Größe (cm)<input type="number" id="oaHeight" min="50" max="250" step="1" inputmode="numeric" value="${esc(profile.height_cm)}"></label>
                    <label>Gewicht (kg)<input type="number" id="oaWeight" min="20" max="300" step="0.1" inputmode="decimal" value="${esc(profile.weight_kg)}"></label>
                </div>
                <button class="oa-btn" type="submit">Speichern</button>
            </form>
            <div class="oa-msg" id="oaMsg" hidden></div>`;
        const $ = s => d.querySelector(s), out = $('#oaMsg');
        const changed = saved => {
            profile = saved;
            $('#oaAva').innerHTML = ava(); $('#oaRemove').hidden = !profile.avatar_path;
            if (onChange) onChange({ ...profile, photo });
        };
        $('#oaPick').onclick = () => $('#oaFile').click();
        $('#oaFile').onchange = async () => {
            const f = $('#oaFile').files[0]; $('#oaFile').value = '';
            if (!f) return;
            $('#oaPick').disabled = true; msg(out, '⏳ Foto wird hochgeladen …', true);
            try {
                const saved = await uploadPhoto(sb, user, profile, f);
                photo = await loadPhoto(sb, saved.avatar_path).catch(() => null);
                changed(saved); msg(out, '✅ Profilbild gespeichert.', true);
            } catch (e) { msg(out, errText(e)); }
            finally { $('#oaPick').disabled = false; }
        };
        $('#oaRemove').onclick = async () => {
            if (!confirm('Profilbild wirklich entfernen? Es verschwindet in allen Apps.')) return;
            try { const saved = await removePhoto(sb, user, profile); photo = null; changed(saved); msg(out, '✅ Profilbild entfernt.', true); }
            catch (e) { msg(out, errText(e)); }
        };
        $('#oaForm').onsubmit = async e => {
            e.preventDefault();
            const num = id => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
            const fields = {
                display_name: $('#oaName').value.trim() || null,
                birthday: $('#oaBirthday').value || null,
                gender: $('#oaGender').value || null,
                height_cm: num('#oaHeight'),
                weight_kg: num('#oaWeight')
            };
            if (fields.birthday && fields.birthday > today()) return msg(out, 'Das Geburtsdatum darf nicht in der Zukunft liegen.');
            const b = $('#oaForm .oa-btn'); b.disabled = true; msg(out, '');
            try { changed(await saveProfile(sb, user, fields)); msg(out, '✅ Gespeichert.', true); }
            catch (err) { msg(out, errText(err)); }
            finally { b.disabled = false; }
        };
    }

    async function openPassword(opts = {}) {
        try { await currentUser(opts.sb); } catch (e) { return; }
        return fillPassword(openModal(''), opts);
    }
    const mountPassword = (el, opts = {}) => fillPassword(mount(el), opts);
    async function fillPassword(d, { sb, redirectTo } = {}) {
        let user;
        try { user = await currentUser(sb); } catch (e) { d.innerHTML = `<p class="oa-note">${esc(errText(e))}</p>`; return; }
        d.innerHTML = `
            ${head(d, '🔑 Passwort')}
            <p class="oa-note">Das Passwort gilt für alle Apps, in denen du dich mit diesem Konto anmeldest.</p>
            <form id="oaPwForm">
                <input type="email" value="${esc(user.email)}" autocomplete="username" hidden>
                <label>Neues Passwort<input type="password" id="oaPw1" autocomplete="new-password" minlength="8" required></label>
                <label>Neues Passwort wiederholen<input type="password" id="oaPw2" autocomplete="new-password" minlength="8" required></label>
                <button class="oa-btn" type="submit">Passwort speichern</button>
            </form>
            <hr class="oa-sep">
            <p class="oa-note">Passwort vergessen? Wir schicken dir einen Link an <b>${esc(user.email)}</b>, mit dem du ein neues festlegen kannst.</p>
            <button class="oa-ghost" type="button" id="oaReset">📧 Link per E-Mail senden</button>
            <div class="oa-msg" id="oaMsg" hidden></div>`;
        const $ = s => d.querySelector(s), out = $('#oaMsg');
        $('#oaPwForm').onsubmit = async e => {
            e.preventDefault();
            if ($('#oaPw1').value !== $('#oaPw2').value) return msg(out, 'Die beiden Passwörter sind nicht gleich.');
            const b = $('#oaPwForm .oa-btn'); b.disabled = true; msg(out, '');
            try { check(await sb.auth.updateUser({ password: $('#oaPw1').value })); $('#oaPwForm').reset(); msg(out, '✅ Passwort geändert.', true); }
            catch (err) { msg(out, errText(err)); }
            finally { b.disabled = false; }
        };
        $('#oaReset').onclick = async () => {
            const b = $('#oaReset'); b.disabled = true; msg(out, '');
            try {
                check(await sb.auth.resetPasswordForEmail(user.email, { redirectTo: redirectTo || location.origin + location.pathname.replace(/[^/]*$/, '') }));
                msg(out, '📧 Link ist unterwegs. Falls nichts ankommt: bitte im Spam-Ordner schauen.', true);
            } catch (err) { msg(out, errText(err)); }
            finally { b.disabled = false; }
        };
    }

    /* E-Mail ändern: Supabase schickt einen Bestätigungslink; erst danach gilt die neue Adresse (in allen Apps) */
    const openEmail = (opts = {}) => fillEmail(openModal(''), opts);
    const mountEmail = (el, opts = {}) => fillEmail(mount(el), opts);
    async function fillEmail(d, { sb, redirectTo } = {}) {
        let user;
        try { user = await currentUser(sb); } catch (e) { d.innerHTML = `<p class="oa-note">${esc(errText(e))}</p>`; return; }
        d.innerHTML = `
            ${head(d, '✉️ E-Mail-Adresse')}
            <p class="oa-note">Mit dieser Adresse meldest du dich in allen Apps an. Aktuell: <b>${esc(user.email)}</b></p>
            <form id="oaMailForm">
                <label>Neue E-Mail-Adresse<input type="email" id="oaMail" autocomplete="email" required></label>
                <button class="oa-btn" type="submit">Bestätigungslink senden</button>
            </form>
            <div class="oa-msg" id="oaMsg" hidden></div>`;
        const $ = s => d.querySelector(s), out = $('#oaMsg');
        $('#oaMailForm').onsubmit = async e => {
            e.preventDefault();
            const email = $('#oaMail').value.trim().toLowerCase();
            if (email === String(user.email).toLowerCase()) return msg(out, 'Das ist schon deine aktuelle Adresse.');
            const b = $('#oaMailForm .oa-btn'); b.disabled = true; msg(out, '');
            try {
                check(await sb.auth.updateUser({ email }, { emailRedirectTo: redirectTo || location.href.split('#')[0] }));
                $('#oaMailForm').reset();
                msg(out, `📧 Bitte bestätige die Änderung über den Link an ${email}. Bis dahin gilt die alte Adresse.`, true);
            } catch (err) { msg(out, /already|registered|exists/i.test(String(err && err.message)) ? 'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.' : errText(err)); }
            finally { b.disabled = false; }
        };
    }

    const css = document.createElement('style');
    css.textContent = `
        .oa-modal { position: fixed; inset: 0; z-index: 20001; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .oa-dialog { width: 100%; max-width: 460px; max-height: calc(100vh - 32px); overflow: auto; background: var(--card, #fff); color: var(--text, #334155); border: 1px solid var(--line, #cbd5e1); border-radius: 16px; padding: 22px; box-shadow: 0 20px 50px rgba(0,0,0,.25); font-family: 'Plus Jakarta Sans', system-ui, sans-serif; line-height: 1.5; text-align: left; }
        .oa-dialog h2 { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 1.15rem; font-weight: 800; color: var(--ink, #0f172a); margin: 0 0 6px; }
        .oa-close { background: none; border: 0; font-size: 1.2rem; color: var(--mute, #64748b); cursor: pointer; padding: 4px 8px; border-radius: 8px; }
        .oa-close:hover { background: var(--hover, #f1f5f9); }
        .oa-note { font-size: .84rem; color: var(--mute, #64748b); margin: 0 0 10px; }
        .oa-dialog form { display: flex; flex-direction: column; gap: 12px; margin: 0; }
        .oa-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 420px) { .oa-grid { grid-template-columns: 1fr; } }
        .oa-dialog label { display: flex; flex-direction: column; gap: 4px; font-size: .78rem; font-weight: 700; color: var(--mute, #64748b); min-width: 0; }
        .oa-dialog input, .oa-dialog select { background: var(--bg, #f8fafc); border: 1px solid var(--line, #cbd5e1); border-radius: 8px; padding: 10px 12px; font: inherit; font-size: 16px; color: var(--ink, #0f172a); width: 100%; min-width: 0; }
        .oa-dialog input:disabled { opacity: .6; }
        .oa-btn { align-self: flex-start; background: var(--p1, #2563eb); color: #fff; border: 2px solid var(--p1, #2563eb); border-radius: 10px; padding: 10px 16px; font: inherit; font-weight: 800; font-size: .95rem; cursor: pointer; }
        :root[data-theme="dark"] .oa-btn { color: var(--bg, #000); }
        .oa-btn:disabled, .oa-ghost:disabled { opacity: .6; cursor: wait; }
        .oa-ghost { background: var(--card, #fff); color: var(--text, #334155); border: 1px solid var(--line, #cbd5e1); border-radius: 8px; padding: 8px 14px; font: inherit; font-weight: 700; font-size: .85rem; cursor: pointer; }
        .oa-ghost:hover { background: var(--hover, #f1f5f9); border-color: var(--p1, #2563eb); }
        .oa-link { background: none; border: 0; padding: 2px 0; font: inherit; font-weight: 700; font-size: .84rem; color: var(--danger, #dc2626); cursor: pointer; }
        .oa-link:hover { text-decoration: underline; }
        .oa-photo { display: flex; align-items: center; gap: 16px; margin: 10px 0 18px; }
        .oa-photo-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
        .oa-ava { width: 92px; height: 92px; flex: 0 0 auto; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center; font-size: 2.8rem; background: var(--hover, #f1f5f9); border: 1px solid var(--line, #cbd5e1); }
        .oa-ava img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .oa-sep { border: 0; border-top: 1px solid var(--line, #cbd5e1); margin: 18px 0 14px; }
        .oa-msg { font-size: .84rem; font-weight: 600; border-radius: 8px; padding: 8px 12px; margin-top: 12px; background: var(--danger-soft, #fee2e2); color: var(--danger, #b91c1c); }
        .oa-msg.ok { background: var(--ok-soft, #dcfce7); color: var(--ok, #15803d); }
        :root[data-theme="dark"] .oa-msg.ok { background: var(--ok-soft, #14361f); color: var(--ok, #86efac); }
        .oa-msg[hidden] { display: none !important; }
        .oa-dialog.oa-inline { max-width: none; max-height: none; overflow: visible; background: none; border: 0; border-radius: 0; padding: 0; box-shadow: none; font-family: inherit; }`;
    document.head.appendChild(css);

    window.OverallAccount = { openSettings, openPassword, openEmail, mountSettings, mountPassword, mountEmail, loadPhoto, close: closeModal, genderLabel: g => GENDERS[g || ''] };
})();
