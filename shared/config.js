/* The Real World – Verbindung zu Supabase (Projekt "realworld-questlog")
   Werte findest du in Supabase unter: Project Settings → API Keys (bzw. "API").
   - url: Project URL, z. B. https://abcdefghijkl.supabase.co
   - key: der "Publishable key" (sb_publishable_…) bzw. bei älteren Projekten der "anon public" Key

   Diese beiden Werte dürfen öffentlich im Repo stehen – sie sind dafür gedacht.
   Den Schutz übernehmen Login + Zugriffsregeln in der Datenbank.
   NIEMALS den "secret" bzw. "service_role" Key hier eintragen! */
window.RQ_CONFIG = {
    url: 'https://jijuxxjhbjrpyunzznec.supabase.co',
    key: 'sb_publishable_T4DRbZ4jRwRqNWUcjxM0TA_wA2ZfvQ3'
};
