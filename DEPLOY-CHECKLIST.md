# The Hound Pack — Render deploy checklist

Short version of the README's Render steps, in the order to do them.
The full detail is in `README.md` in this folder.

## Before you deploy

- [ ] Put the project in a GitHub repo (upload everything except `node_modules/` and `data/` — `.gitignore` already excludes them).
- [ ] Pick a **paid** Render instance type (Starter or above). Render only offers Persistent Disks on paid services, and without the disk your members, posts and uploads are wiped on every redeploy. (Render docs: https://render.com/docs/disks)
- [ ] Render generates a `JWT_SECRET` for you from `render.yaml` — don't put a real secret in the repo.

## Deploy

- [ ] In Render: **New + → Web Service** (or Blueprint), connect the repo. Build: `npm install`, Start: `npm start`.
- [ ] Confirm the Persistent Disk exists before you go live: service → **Disks** should show `hound-pack-data` mounted at `/var/data` (1 GB to start). `render.yaml` already declares it — if the dashboard doesn't show it, add it there manually with mount path `/var/data`.
- [ ] Deploy and open your `onrender.com` URL.

## First 10 minutes after deploy

- [ ] Sign up as **`bludhound420`** first — that username gets Founder/Admin status (`FOUNDER_USERNAME` in `render.yaml`).
- [ ] Post the welcome moment and check it survives a restart (Render dashboard → Manual Deploy → Deploy latest commit, then reload — your post should still be there). If it's gone, the disk isn't attached.
- [ ] Do the two-browser Voice & Video check with a friend (the server-side test here had no camera/mic, so this is the one thing not yet verified live). If a strict network blocks it, the README explains adding a TURN server via `RTC_CONFIG` in `public/app.js`.
- [ ] Replace `YOUR-SITE-URL` in `public/index.html` (search for it — it's in the invite box) with your real Render URL, commit, and redeploy so copied invites include the live link.
- [ ] Turn on **Auto-Deploy** (on by default for GitHub) and leave Dependabot (`.github/dependabot.yml`) enabled — that's the weekly security-update path.

## If the Pack outgrows the disk

The README's "About the data storage" section covers moving the JSON store to Supabase Postgres when you need it — the rest of the app doesn't change.
