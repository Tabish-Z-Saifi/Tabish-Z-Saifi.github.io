# Wedding Guest List — v2 (Firebase sync)

A mobile-first PWA for managing large Indian/Pakistani wedding guest lists (600+ guests),
with real-time cloud sync across family members' devices via Firebase (free tier).

The original zero-setup, localStorage-only version is preserved in [`v1-local/`](v1-local/).

## Files
- `index.html` · `styles.css` — UI
- `js/app.js` — UI logic · `js/store.js` — all Firestore/Auth calls · `js/firebase.js` — init
- `js/config.js` — **you paste your Firebase config here (required)**
- `firestore.rules` — security rules (paste into Firebase console, **required**)
- `manifest.json` · `sw.js` · icons — installable PWA + offline shell

## One-time Firebase setup (~10 minutes, free, no credit card)

1. Go to https://console.firebase.google.com → **Add project** (any name, Analytics off is fine).
2. **Build → Authentication → Get started** → enable **Email/Password**, then enable **Google**
   (set the support email when asked).
3. **Build → Firestore Database → Create database** → *production mode* → pick a region near you
   (e.g. `asia-south1` for India).
4. Firestore → **Rules** tab → delete everything → paste the full contents of
   [`firestore.rules`](firestore.rules) → **Publish**.
5. Project settings (gear icon) → **Your apps** → **Web** (`</>`) → register the app →
   copy the `firebaseConfig` values into [`js/config.js`](js/config.js).
   (The apiKey is not a secret — the security rules are what protect the data.)
6. **Authentication → Settings → Authorized domains** → add your GitHub Pages domain
   (e.g. `yourname.github.io`). `localhost` is already allowed.
7. Push these files to GitHub Pages. Done — reload the app and sign up.

## How accounts work
- **One account = one wedding.** Uncle's daughter's wedding = a completely separate account
  (he signs up and taps "Create wedding"). Firestore rules make cross-account access impossible.
- **Profiles:** each family member (you, mom, dad) signs up with their own login, then joins your
  account with an **invite code** (More → Invite a family member; codes are single-use, 24h expiry).
- Every guest card shows **who added it and who last edited it**.
- Access can be revoked anytime (More → Family access → ✕).

## WhatsApp invites
Upload your invitation card image + message once (More → WhatsApp invitation). On any
"WhatsApp + Call" guest, tap **Invite** → the native share sheet opens pre-loaded → pick the
contact in WhatsApp → send → come back and confirm "Mark Invited".
(Browsers cannot auto-pick a contact or auto-send; the share sheet resolves when you finish,
so the app prompts you right after.)

## Offline
Firestore's local cache keeps the app fully usable offline — changes queue up and sync when
you're back online. The service worker keeps the app shell loading offline too.

## Costs
Firestore free tier: 1 GB storage, 50K reads + 20K writes/day. A 600-guest wedding uses well
under 1% of this. The invitation image is compressed and stored inside Firestore, so no paid
Storage plan is needed. Realistic cost: **$0**.

## Backups
More → **Download backup (JSON)** any time. Sync is automatic; the backup is a safety copy
that outlives the Firebase account (useful for siblings' future weddings).
