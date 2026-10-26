# ViziTrack (Nexus Gate Kiosk) — Security Audit

Date: 2026-10-26 · Scope: `kiosk.html`, `index.html` (is repo ka code). Backend (Supabase tables/RLS/RPC,
Apps Script endpoints) is repo mein nahi hai, isliye un findings ko sirf report kiya gaya hai — fix wahan karna hoga.

Severity: **High** = koi bhi bahar ka banda iska fayda utha sakta hai · **Medium** = sahi halat mein nuksaan ·
**Low** = hardening / best practice.

---

## Fixed in this branch (kiosk.html)

### F1 · HIGH — QR se kisi bhi visitor ke naam se check-in (identity bypass) — FIXED
`onQr()` mein `VZT:<uuid>` badge ke alawa ek JSON QR (`{"email":"someone@x.com"}`) bhi maana jaata tha.
UUID guess nahi ho sakta, lekin email to sabko pata hota hai. Koi bhi phone par kisi guest ke email wala JSON
QR bana kar us visitor ke roop mein check-in kar sakta tha — na OTP, na face. Ab sirf `VZT:<uuid>` badge chalta hai;
baaki sab ke liye OTP/Face.

### F2 · MEDIUM — Stored XSS: Work Pass cards — FIXED
`wpRenderPunch()` `w.name`, `w.pass_no`, `w.department`, `w.id` ko bina `esc()` ke `innerHTML` mein daal raha tha.
Work pass HR/Employee Portal se banta hai — jo bhi pass bana sakta hai wo naam mein `<img onerror=...>` daal kar
kiosk (jo ek logged-in Supabase session rakhta hai) par JS chala sakta tha. Ab sab fields escaped hain.

### F3 · LOW — Server error strings HTML ke roop mein render — FIXED
Work pass / OT / fuel ke `catch` blocks `e.message` seedha `innerHTML` mein daal rahe the. Postgres/PostgREST
error messages mein user input echo ho sakta hai. Ab `esc()` lagta hai. Saath mein OT `o.id`, fuel `log_date`
attribute/HTML mein bhi escape kiye.

### F4 · LOW — Unpinned CDN libraries (supply chain) — FIXED
`@supabase/supabase-js@2` aur `@vladmandic/face-api@latest` (+ model URL) bina version ke the. Agar package
compromise hota ya breaking release aati, kiosk pe seedha asar. Ab `2.118.0` / `1.7.15` pin hain.
`html5-qrcode@2.3.8` pehle se pinned tha.

---

## Needs fixing outside this repo (Supabase / Apps Script)

### B1 · HIGH — OTP / mail API key page source mein hard-coded
`MAIL_API_KEY` kiosk.html line 15 mein plain text hai, aur git history (commit `9e2b5ac`) mein bhi.
Page public GitHub Pages par hai, to ye key sabke paas hai. Isse koi bhi `sendOtp` call karke kisi bhi
mobile/email par unlimited OTP/WhatsApp spam kar sakta hai, aur `verifyOtp` par 6-digit code brute-force
(10 lakh combos, 3 min window) try kar sakta hai.
Karna kya hai: Apps Script mein (a) key rotate karo, (b) per-target rate limit (e.g. 3 OTP / 10 min),
(c) verify par max 5 attempts phir OTP invalidate, (d) OTP sirf un email/mobile ko bhejo jinki active
invitation ho. Browser ke code mein koi bhi key "secret" nahi rehti — isliye asli suraksha server-side limits hi hai.

### B2 · HIGH — Supabase RLS policies verify karo (kiosk login se poora DB)
Kiosk ek shared "device" account se login karta hai (`signInWithPassword`) aur phir seedha tables par
`select / insert / update` karta hai:
`visitor_logs` (select *, insert, update), `invitations` (select *), `face_data` (select, insert), `hosts`,
`requests` (insert), storage bucket `attendance-photos` (upload), aur RPCs `wp_list / wp_punch / wp_photo /
ot_kiosk_list / ot_kiosk_verify / ot_kiosk_notfound / fuel_kiosk_staff / fuel_kiosk_add` …
Kiosk ka password gate par guard ke paas hota hai. Agar RLS kiosk role ko sirf in-hi operations tak limit nahi
karta (e.g. `visitor_logs` delete, `invitations` update, `hosts` update, payroll tables), to kiosk credentials
se poora Nexus_Payroll DB expose hai. Supabase MCP se `get_advisors(security)` chala kar check karo.
Minimum: kiosk role ke liye `visitor_logs` par update sirf `check_out_time` column; `invitations` read-only;
`face_data` insert sirf apni email; baaki tables deny.

### B3 · MEDIUM — Anon/publishable key + URL public Apps Script se aati hai
`nxConfig()` ek public JSONP endpoint se Supabase URL + key laata hai. Ye design theek hai (publishable key
secret nahi hoti) **lekin** phir sab kuch RLS par tikta hai (B2). Saath hi JSONP = us Apps Script ka JS seedha
page mein execute hota hai; agar wo Apps Script account compromise ho to kiosk bhi. Agar possible ho to
JSONP ki jagah `fetch()` + JSON (Apps Script `ContentService` JSON + CORS) use karo.

### B4 · MEDIUM — Check-out mein ownership check nahi
`insideCheckout(id)` aur queued `checkout` kisi bhi `visitor_logs.id` par `update check_out_time` karta hai.
Client side par ye theek hai (guard ka kaam hai), lekin RLS mein ensure karo ki kiosk sirf `check_out_time IS NULL`
rows par aur sirf us column ko update kar sake (abhi client `.is('check_out_time', null)` bhejta hai, par wo
client-side filter hai, enforcement nahi).

### B5 · MEDIUM — Face descriptors (biometric data) poora kiosk download karta hai
`face_data.select('email,descriptor')` → sab visitors ke face embeddings + emails kiosk par aate hain aur IndexedDB
cache mein rehte hain. Kiosk tablet chori/lost hone par ye data bahar jaata hai. Options: sirf aaj ke active
invitations wale emails ke descriptors lao; IndexedDB cache ko logout/din ke end par clear karo; DPDP Act ke hisaab
se visitor consent + retention policy rakho.

### B6 · LOW — Request form par koi rate-limit / captcha nahi
`submitRequest()` anon kiosk se `requests` table mein insert karta hai; koi bhi gate par khada hokar hazaaron
fake requests daal sakta hai (hosts ko notification spam). DB trigger / RLS se per-mobile per-day limit lagao.

### B7 · LOW — Kiosk session kabhi expire nahi hota, logout nahi hai
Supabase session localStorage mein persist hai, UI mein sign-out nahi. Tablet chori ho to session bhi gaya.
Suggest: HR Admin se kiosk user ka password reset = sab sessions revoke; ya kiosk ko daily re-login.

### B8 · INFO — `hosts` table se saare host names kisi bhi visitor ko dikhte hain
Request form ka datalist sab employee names expose karta hai. Shayad intended hai (visitor ko host chunna hai),
par note kar lo ki ye employee directory leak hai.

---

## Quick checklist (priority order)
1. Apps Script: `MAIL_API_KEY` rotate + OTP rate limit + verify attempt limit  (B1)
2. Supabase: kiosk role ke RLS policies audit — `get_advisors`  (B2, B4)
3. Is branch ko deploy karo (F1–F4)
4. Face data scope/retention decide karo (B5)
