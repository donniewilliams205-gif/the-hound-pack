# 🐺 The Hound Pack — Full Release

A real, self-hosted gaming community website. Not a demo: every account, post,
chat message, coin and gift is saved in a real database on your server and is
shared between everyone who uses the site.

Founded by Houndy (@Bludhound420).

## What's inside

- **Accounts** — sign up / log in / log out. Passwords are hashed with bcrypt
  (never stored in plain text). Login sessions use a signed, httpOnly cookie.
  The username in `FOUNDER_USERNAME` (default `bludhound420`) becomes the
  Founder/Admin when it signs up.
- **Feed & rooms** — The Den, Clip Vault, Pet Pics, Setup Flex, Chill Corner
  (21+, unlocked by the 21+ checkbox), Meme Cave, Wins & Fails, Beats & Music,
  Munchie Runs. Filter the feed by room.
- **Posting** — text moments, picture uploads (JPG/PNG/GIF/WebP, max 5 MB) or
  picture links, and clip posts (YouTube links play inline). Posting earns
  5 Hound Coins. Comments, emote reactions, share/copy-link, delete your own posts.
- **Chat** — live lobby chat (Socket.IO) that is saved, so it is still there
  after a restart.
- **Voice & Video Lounge** — real browser-to-browser voice/video using WebRTC,
  with this server handling the introductions ("signaling"). 4 channels, mic
  and camera toggles, screen sharing, raise hand. Works best with a handful of
  people per channel.
- **Hound Coins & gifts** — new accounts start with 100 coins. Balances live in
  the database. Sending a gift in the Gift Den (8 gifts) moves real coins from
  you to the recipient and records it on their gift shelf.
- **More** — leaderboard, profiles (display name, avatar emoji, bio), XP and
  levels, events with RSVP, a Pack poll, Pack Quests / Daily Howl (+20 coins
  once a day), house rules, FAQ, and an invite box.
- **Aegis Shield security center** — helmet security headers, login
  rate-limiting, and a security event log (signups, failed logins, rate-limit
  hits) that the Founder can see in the sidebar.

## Run it on your own computer (try it out)

You need Node.js 18 or newer (nodejs.org).

```bash
npm install
cp .env.example .env      # on Windows: copy .env.example .env
```

Open `.env` and change `JWT_SECRET` to a long random line of your own.
Then:

```bash
npm start
```

Open http://localhost:3000 — the first thing to do is **sign up with the
username `bludhound420`** so your account gets the Founder crown.

## Put it on the internet with Render (recommended)

1. Put this project in a GitHub repository (upload all files except
   `node_modules` and `data` — the included `.gitignore` handles that if you
   use git).
2. In Render: **New + → Web Service**, connect your repository. Render reads
   `render.yaml` automatically: build `npm install`, start `npm start`.
3. **Add a Persistent Disk** (service → Disks): mount path `/var/data`,
   1 GB is plenty to start. `render.yaml` already sets `DATA_DIR=/var/data`
   and generates a `JWT_SECRET` for you.
4. Deploy. Open your Render URL, sign up as `bludhound420` for Founder.

> ⚠️ The persistent disk matters: without it, Render erases the filesystem on
> every redeploy and your members, posts and uploads would be lost.

**Keeping it updated:** enable "Auto-Deploy" on your Render service (it is on
by default for GitHub) — every push to your main branch redeploys the site.
This project includes Dependabot (`.github/dependabot.yml`), which opens a
weekly pull request whenever a library it uses gets a security fix. Review,
merge, and Render redeploys. That — not magic — is the real update system.
The in-app Security & Updates center shows the running version and the
security event log.

## About the data storage (honest notes)

Data is stored in one JSON file (`db.json`) in `DATA_DIR`, with atomic writes
(write-to-temp-then-rename) and a rolling backup (`db.backup.json`) so a crash
can't corrupt it. Uploaded pictures are stored in `DATA_DIR/uploads`.

This is simple and reliable for a small-to-medium community on one server with
a persistent disk. If the Pack grows big, the next step is a real database:
**Supabase (Postgres)** is a good fit — you would move the tables in
`store.js` (users, posts, gifts, chat, events, poll) into Postgres and swap
the save/load functions for queries. The rest of the app doesn't need to change.

## Voice & Video notes (STUN / TURN)

The Lounge ships with free public STUN servers (Google), which connect most
home networks. Some strict/corporate networks block direct browser-to-browser
connections; for those members you would add a **TURN server** (for example a
coturn server you host, or a metered service like Twilio/Metered) and add it
to `RTC_CONFIG` in `public/app.js`. Until then, most home users will connect
fine without one.

## After you deploy: your invite link

In the "Invite the Pack" box on the site, replace `YOUR-SITE-URL` with your
real address (your Render URL, e.g. `https://the-hound-pack.onrender.com`).
That text lives in `public/index.html` — search for `YOUR-SITE-URL`.

## Files

| File | What it is |
|---|---|
| `server.js` | The whole backend: API, auth, chat, voice/video signaling |
| `store.js` | The data layer (JSON file, atomic writes, backups, seed content) |
| `public/` | The website itself (HTML, CSS, JS) |
| `render.yaml` | One-click Render setup |
| `.env.example` | Settings template — copy to `.env` |
| `.github/dependabot.yml` | Weekly security update pull requests |

The only seeded content is the Founder's welcome post, two starter events and
one starter poll — real initial content for your community, not fake members
or fake activity. Everything else is created by your real members.
