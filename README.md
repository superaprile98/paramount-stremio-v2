<p align="center">
  <img src="public/icon.png" alt="PPlus" style="margin: 20px 0; width: 400px; height: auto;">
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node-20+-orange">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Ready-blue.svg">
  <img alt="HLS" src="https://img.shields.io/badge/HLS-Streaming-red.svg">
</p>

# Unofficial Paramount+ Stremio Addon

> [!WARNING]  
> DISCLAIMER: This project is not associated with Paramount in any way. This project does not provide pirated content in any way, a valid Paramount+ account is required to access content. As described in Paramount's terms and conditions, using proxy services is considered abuse. Use of this software is at the user's sole discretion, and we assume no responsibility for its use or any repercussions on the account used.

This is an add-on that allows you to view the contents of your Paramount+ account directly within Stremio. To use it, you need to log in with your account. <ins>Currently, only US accounts are supported.</ins>

<a href="https://buymeacoffee.com/rionoir" target="_blank">
  <img alt="Support" src="public/support-banner.png" width="100%">
</a>

## ✨ Features

- Account login with **Device Code** (like a TV) or **email + password** (server-side, through the proxy — no browser activation required)
- Automatically generated catalogs/meta, always up to date (live TV, sports, movies and series)
- Auto-proxed streams directly from the addon (HLS for live/sports, DASH/MPD proxy for VOD)
- IPTV playlist (M3U) and EPG export for external players
- Multiple accounts with a single instance of the addon
- **Sports-only view** with per-league catalogs (custom `Sport` content type), replays and per-profile preferences

## ⚽ Sports view

The addon exposes a dedicated **sports-only** experience in Stremio. Catalogs use the custom `sport` content type (displayed as **Sport** in Stremio) and are organized as **5 fixed home sections**:

1. **Serie A** — the Italian Serie A.
2. **UEFA Champions League**
3. **UEFA Europa League**
4. **UEFA Conference League**
5. **Altro** — every other sport/league on Paramount+ (Premier League, NBA, NFL on CBS, UFC, etc.) in a single section.

Each section is browsable by genre:

- `Live`, `Upcoming`, `Replay` — filter the section by match status.
- For the **Altro** section only, the dropdown also lists the names of the remaining leagues: selecting a league shows only that league's events.

- **Replays** — finished matches can be re-watched from each catalog. Note: replays depend on Paramount's `previousListings` field being populated, which is empty at the start of each season. The replay-classification logic was hardened so that listings without an explicit `endMs` are now correctly shown as `Replay` rather than dropped.
- **Per-profile preferences** — each profile can set **one or more favorite teams** (with quick-pick suggestions like Inter, Milan, Juventus, Roma, Lazio, Napoli, Atalanta, Fiorentina) and **show/hide** individual leagues. Favorite teams are highlighted at the top of every Sport catalog. Configure them on the `/configure` page (the ⚽ Sports View banner at the top of the page).

> Movies and series are intentionally **not** part of the sports view; they remain available through the standard catalogs.

## 💥 Known issues

### VOD / DRM limitations (important)

- **VOD content (movies and series) is protected by Widevine DRM** (Irdeto). The desktop Stremio player does **not** include a Widevine CDM, so VOD playback is only possible on players that ship a CDM (e.g. Stremio on Android TV, or external players with Widevine support).
- The addon proxies the DASH/MPD manifest and the Widevine license endpoint (`/api/proxy/:sid/mpd`, `/api/proxy/:sid/license`) so that players with a CDM can play VOD content. It does **not** decrypt or bypass DRM in any way.
- If your player has no CDM, VOD streams will stop after a few seconds (the license request fails). This is a player limitation, not an addon bug.
- Live TV and sports use HLS when available and work on all players. The addon now **prefers HLS (`.m3u8`) over DASH (`.mpd`)** when the Irdeto token contains both, so replays and live channels that expose an HLS variant play everywhere. Only content that is exclusively DASH (some replays/VOD) falls back to the MPD proxy and needs a Widevine-capable player.

### Other known issues

- **US-only service**: the addon talks to the **US** Paramount+ API (`www.paramountplus.com`, US `at` token). If you are outside the US, the activation page will geo-redirect you to your local Paramount+ (a separate system with separate accounts) and the device code will never be accepted. To activate, open `https://www.paramountplus.com/activate/androidtv/` from a browser that exits from a US IP (US VPN or the same proxy used by the addon — your IP must be whitelisted). The page must show "Activate Paramount Plus on Android TV" in English.
- **No browser access to the proxy? Use the password login.** The device-code flow needs the user's own browser to reach `paramountplus.com/activate`, which fails when the upstream proxy only whitelists the server's IP (a common setup with shared rotating proxies like Webshare). To work around this, `/configure` exposes a second tab ("Email + password") that performs the login **server-side**, through the same proxy the addon uses for streams: only the addon container needs to talk to Paramount+, the user only types credentials in the configure page. The request is rate-limited (5 failed attempts / 15 min per IP) to avoid Paramount+ IP bans. Credentials are never stored: they are exchanged for session cookies and sealed into a JWE, exactly like the device-code flow.
- Some players (such as KSPlayer) may freeze during commercials due to poor support for the m3u #EXT-X-DISCONTINUITY tag (we recommend using libVLC or an external player that supports this tag).
- If you see an HTTP 403 error during playback, your IP may have been permanently banned (this happens when using a VPN). We recommend changing your DNS server and trying again.
- The addon login session is valid for one year. If you notice that the addon is no longer working, try logging in again.

## 🛠️ Troubleshooting

### "Failed to fetch" when installing the addon in Stremio desktop

Stremio desktop loads its UI from `https://app.strem.io` (HTTPS). Chromium blocks *mixed content* (HTTPS → HTTP) for security, and **exempts only `localhost`**. If your `BASE_URL` is set to a LAN IP (e.g. `http://192.168.1.9:7850`) and you try to install the addon from the desktop app on the same machine, the manifest fetch is blocked and Stremio shows `Failed to fetch: Failed to fetch`.

**Fix:**
- If you only use Stremio **on the same PC** that hosts the addon: set `BASE_URL=http://localhost:7850` in `.env`, then `docker compose up -d --build` and re-activate.
- If you also need to use the addon from a **TV or phone on the LAN**: expose the addon via HTTPS (e.g. Cloudflare Tunnel, ngrok, Tailscale Funnel) and set `BASE_URL` to the public HTTPS URL. The `localhost` and the LAN-IP URLs will both keep working for catalog browsing.
- The HTML `/configure` page works fine on either URL (no mixed-content restriction on plain HTTP pages loaded directly).

### "Open in Stremio" button on `/configure` does nothing

The `/configure` page builds a `stremio://<manifest-url>` deep link from the **Host header** of the request. When the addon is running locally:

- If `BASE_URL` is **not** set, the deep link uses whatever hostname you opened `/configure` on (e.g. `http://localhost:7850`, `http://192.168.1.9:7850`). Stremio desktop can install from `localhost` or from the same LAN IP, so it should work as long as both machines are on the same network. Otherwise, the deep link opens Stremio but the manifest is unreachable, so the install fails silently.
- If the deep link points to a private/LAN address, `/configure` shows a yellow ⚠️ **Local address detected** banner that explains the situation and tells you to either set `BASE_URL` to a public domain or copy the manifest URL manually and paste it into Stremio (*Addons → Community → Install via URL*).

**Fix:** set `BASE_URL` to the URL that Stremio desktop will be able to reach (typically `http://localhost:7850` for a same-PC install, or your public HTTPS URL when exposing the addon on the internet), then re-activate the addon.

## 💾 Installation

Before proceeding with the installation, you must generate a <b>random key</b>, which will be used to encrypt the login session.

Example with OpenSSL:
```
openssl rand -hex 32
```
If you don't have OpenSSL, you can generate a key online, for example [here](https://randomkeygen.com/). <br>
Be sure not to share your key.

---

### ☁️ Deploy on Vercel
If you don't have the option to host the add-on on your own server, you can easily create it with Vercel. Just click on the button below, and remember to configure the environment variables.

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRioNoir%2Fparamount-stremio&env=BASE_URL,KEY_SECRET,TIMEZONE&project-name=paramount-stremio&repository-name=paramount-stremio"><img src="https://vercel.com/button" alt="Deploy with Vercel"/></a>

Please note: On Vercel the add-on may not work due to IP blocking.

---

### 🆓 Deploy on Oracle Cloud Free Tier (recommended for a public URL)

Oracle Cloud offers **Always Free** ARM/Ampere A1 instances — enough to run this addon 24/7 with a public IP. The recommended setup is **Docker-first**: a single idempotent script installs Docker, generates `.env` (with a fresh `KEY_SECRET`), builds the image and starts the container with `docker compose`. The container runs as a non-root user with a named volume for persistent data and an automatic healthcheck.

The installer auto-detects the distro and works on **Oracle Linux 9** (`dnf`) and **Ubuntu 22.04/24.04 LTS** (`apt`) — both officially supported on Ampere A1 Always Free.

**Prereqs**: a VM.Standard.A1.Flex instance running Oracle Linux 9 or Ubuntu 22.04/24.04, with ports `7850` (or `80`/`443`) open in the Oracle Security List, SSH key, and this repo already cloned to `/home/ubuntu/paramount-stremio`. The addon runs comfortably on **2 OCPU + 12 GB RAM** (or any config with ≥ 2 GB RAM). With 1 GB RAM you need to add swap — see below.

```bash
# 1) (Only on 1 GB RAM VMs) install swap — not needed on 2+ GB.
sudo bash scripts/setup-swap.sh   # opzionale se la VM ha >= 2 GB RAM

# 2) Run the Docker installer
sudo bash scripts/deploy-docker.sh
#   - detects your public IP automatically
#   - installs Docker Engine + compose plugin (get.docker.com)
#   - clones/updates the repo in /home/ubuntu/paramount-stremio
#   - creates .env from .env.example and generates KEY_SECRET
#   - docker compose up -d --build
#   - waits for the /api/health healthcheck and prints the final URL

# 3) Open the Security List ingress for port 7850 (or put nginx + Let's Encrypt in front)

# 4) To update later:
sudo bash scripts/update-docker.sh
```

**Useful commands**:

```bash
docker compose ps
docker compose logs -f            # live log
docker compose restart
sudo nano /home/ubuntu/paramount-stremio/.env   # change BASE_URL/PORT/KEY_SECRET here
```

> A bare-metal alternative (Node.js + `systemd`, no Docker) is also available: `sudo bash scripts/install-oracle.sh` / `scripts/update-oracle.sh`. See [`deploy/oracle/README.md`](deploy/oracle/README.md) § 7.

Full guide, troubleshooting, and optional nginx + Let's Encrypt setup: see [`deploy/oracle/README.md`](deploy/oracle/README.md).

---

### 💻 Manual installation

The following tools are required for manual installation: [git](https://git-scm.com/install/), [node/npm](https://nodejs.org/en/download/current) (20+).

```bash
git clone https://github.com/RioNoir/paramount-stremio.git#main
cd paramount-stremio

###
# Before starting the addon, create an .env file with the required environment variables. See below.
# Example:
# BASE_URL=http://localhost:3000
# KEY_SECRET=[random-key]
###

npm install
npm run start #Starting Addon

#with custom port (optional)
npm run start -- --port 7850
```
By default addon web ui will be available at: `http://localhost:3000`

---

### 🐳 Install with docker build/run

The following tools are required for docker installation: [git](https://git-scm.com/install/), [docker](https://docs.docker.com/engine/install/).

```bash
#Image build
docker build -t paramount-stremio https://github.com/RioNoir/paramount-stremio.git#main

#Start addon
docker run --name Paramount-Stremio -e BASE_URL=http://localhost:7850 -e KEY_SECRET=[random-key] -p 7850:7850 -d paramount-stremio
```
Addon web ui will be available at: `http://localhost:7850`

---

### 🐳 Install with docker compose (recommended)

The following tools are required for docker installation: [git](https://git-scm.com/install/), [docker](https://docs.docker.com/engine/install/).<br><br>
The repo ships a production-ready [`docker-compose.yml`](docker-compose.yml) (non-root user, named volume for persistent data, log rotation, memory cap, healthcheck). Just configure the environment and start:

```bash
git clone https://github.com/superaprile98/paramount-stremio-v2.git
cd paramount-stremio-v2

cp .env.example .env
# edit .env: set KEY_SECRET (openssl rand -hex 32) and BASE_URL

docker compose up -d --build
```
Addon web ui will be available at: `http://localhost:7850`

---

### 📖 Environment variables

You can configure or set the following environment variables in an `.env` file. This applies to all types of installation.

| Variable     | Value                                                        | Required | Description                                                                                                              |
|:-------------|:-------------------------------------------------------------|:---------|:-------------------------------------------------------------------------------------------------------------------------|
| `BASE_URL`   | `http://localhost:7850`                                      | YES      | The URL that the app will place in front of all generated links. This can be the link to your proxy server to use HTTPS. |
| `PORT`       | `7850`                                                       | NO       | The port of the addon.                                                                                               |
| `KEY_SECRET` | `<random-key>`                                               | YES      | Randomly generated key to encrypt the login session. At least 20 characters recommended.                                 |
| `TIMEZONE`   | `America/New_York`                                           | NO       | Time zone used to format dates.                                                                                          |
| `PROXY_URLS` | `http://sing-box:8888`                                       | NO       | Comma-separated list of HTTP/HTTPS/SOCKS5 proxies. The addon uses them in **round-robin** and **falls back automatically** when one returns `402` (bandwidth limit) or a connection error. With docker compose the default is `http://sing-box:8888` (the VLESS proxy container). If empty, falls back to `HTTP_PROXY`. |
| `HTTP_PROXY` | `https://<username>:<password>@us8682.<vpn-provider>.com:89` | NO       | Single HTTP/HTTPS/SOCKS5 proxy (legacy). All HTTP calls from the addon will be made using this. Ignored if `PROXY_URLS` is set. |
| `SUBSCRIPTION_USER_AGENT` | `sing-box/1.11.0`                              | NO       | User-Agent used when the addon downloads the VLESS subscription URL from `/configure`. Some providers require a specific one. |
| `FORCE_HQ`   | `true`                                                       | NO       | When enabled, sorts HLS variants by bandwidth (highest first) in the rewritten master playlist.                          |
| `STRIP_DISCONTINUITY` | `true`                                          | NO       | Removes `#EXT-X-DISCONTINUITY` tags from media playlists (workaround for players that freeze on commercials).           |
| `PPLUS_UPSTREAM_ALLOWED_HOSTS` | `<comma-separated>`                     | NO       | Allowlist of upstream hosts the proxy may relay to (SSRF hardening). Defaults to the Paramount+ domains.                 |
| `PROXY_PROBE_URL` | `https://www.paramountplus.com/`                        | NO       | URL used by the startup probe to test each proxy (default: Paramount+ homepage). Set to empty string to disable.         |

---

## 🌐 Multi-proxy & VPN detection

The addon supports **multiple proxies** (e.g. several ProtonVPN endpoints, a mix of VPN + residential) via `PROXY_URLS` (comma-separated). For each request the client picks a proxy via **round-robin**, skipping any that are currently marked as "dead".

A proxy is marked as unhealthy when:

* It returns **HTTP 402** (bandwidth limit / paywall) → status `throttled`, cooldown 5 min.
* It returns **403 / 407 / 451** with a body matching `vpn|proxy|unblock|geo-block|not available in your country` → status `blocked`, cooldown 30 min (Paramount+ detected the VPN).
* Connection error (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `ERR_BAD_RESPONSE`, …) → status `dead`, cooldown 2 min.
* A successful response raises the proxy's score; a failure lowers it.

On startup the addon **probes every proxy in parallel** against `PROXY_PROBE_URL` (default: `https://www.paramountplus.com/`) and only uses the ones that pass. It re-probes every 5 minutes so a proxy that recovers is automatically re-enabled.

Inspect the live status:

```bash
curl https://addon.example.com/api/proxy/status
# → { "summary": {...}, "proxies": [{ url, status, score, excluded, ... }] }

# Force a fresh probe (e.g. after switching servers):
curl -X POST -H 'Content-Type: application/json' \
     -d '{"action":"reprobe"}' https://addon.example.com/api/proxy/status
```

### 🧩 VLESS / subscription proxy setup (recommended)

Paramount+ US geo-blocks many VPN endpoints. The addon ships with a **sing-box** container that acts as a local HTTP proxy (`http://sing-box:8888`) and supports **VLESS, Hysteria2, VMess, Trojan and Shadowsocks** — the same share-link formats used by Hiddify, v2rayNG, sing-box, etc. No WireGuard keys or `.conf` files to manage: you just paste your **subscription URL**.

1. Get a subscription URL from your proxy provider (e.g. `https://provider.com/sub?token=...`). It returns the server list as base64-encoded share-links.
2. Open the addon UI at `https://addon.example.com/configure` and go to the **🧩 VLESS / Subscription** card.
3. Paste the subscription URL and click **🔍 Fetch servers** — the addon downloads it (directly, no proxy) and shows the parsed servers.
4. Pick **Auto** (recommended: sing-box picks the fastest server via `urltest` failover) or a specific server, then click **💾 Save & connect**.
5. The addon writes `vpn-data/sing-box/config.json`; the systemd path unit restarts the container automatically (2-5 s). Click **🧪 Test connection** to do a live probe against `https://www.paramountplus.com/` through the tunnel and see the exit IP, country, city, and ISP. The result is one of: **✅ OK** / **⚠️ VPN detected** / **🌍 Geo-blocked (HTTP 451)** / **❌ Connection failed**.

If the test reports **VPN detected** or **Geo-blocked**, switch to a different server from the dropdown (or a different provider) and retry.

> **One-time SSH setup** (30 s): to make the new config take effect automatically without SSH every time, run once on the host:
> ```bash
> sudo bash scripts/install-vpn-watcher.sh
> ```
> This installs a systemd path unit that watches `vpn-data/sing-box/config.json` and runs `docker compose --profile vpn up -d sing-box` whenever the addon rewrites it (this also creates the container on first use). After this, save in the UI → 2-5 s later the tunnel is live. Uninstall with `sudo bash scripts/install-vpn-watcher.sh --uninstall`.

### 🖱️ One-click VPN setup from `/configure`

If you don't want to SSH into the server every time, the configure UI exposes a card **🌐 VPN / Proxy** that lets you configure the tunnel without editing files. Two modes:

1. **🧩 VLESS / Subscription** — paste any subscription URL (VLESS/Hysteria2/VMess/Trojan/SS share-links) or a single share-link. The addon parses it, writes the sing-box config and restarts the container. This is the recommended way.
2. **🔌 HTTP proxy URL** — paste any HTTP/HTTPS/SOCKS5 proxy URL (with optional `user:pass@` credentials) without using a VPN tunnel at all.

After saving, click **🧪 Test connection** to do a live probe against `https://www.paramountplus.com/` through the new tunnel and see the exit IP, country, city, and ISP. The result is "✅ OK" / "⚠️ VPN detected" / "🌍 Geo-blocked (HTTP 451)" / "❌ Connection failed".

---

## 🗺️ Routes

The addon exposes the following HTTP endpoints (all under the configured `BASE_URL`):

| Route | Description |
|:------|:------------|
| `/` | Web UI (login with Device Code, copy manifest / M3U / EPG links) |
| `/configure` | Same as `/` (alias) |
| `/api/health` | Health check for orchestration (Docker HEALTHCHECK, load balancers) |
| `/api/auth/device/start` | Starts the Paramount+ device-code login flow |
| `/api/auth/device/poll` | Polls the login flow until the user authorizes the device |
| `/api/stremio/:key/manifest.json` | Stremio addon manifest (catalogs, resources, types) |
| `/api/stremio/:key/catalog/:type/:id/...` | Stremio catalogs (live, sports, movies, series) |
| `/api/stremio/:key/meta/:type/:id` | Stremio metadata for a single item |
| `/api/stremio/:key/stream/:type/:id` | Stremio stream resolution (HLS / DASH) |
| `/api/stremio/:key/prefs` | Per-profile sports preferences (GET) and actions (POST: set, addTeam, removeTeam, hideLeague, showLeague) |
| `/api/stremio/:key/proxy/hls` | Internal HLS proxy (rewrites master/media playlists) |
| `/api/stremio/:key/proxy/seg` | Internal HLS segment proxy |
| `/api/stremio/:key/proxy/license` | Internal AES-128 HLS key proxy |
| `/api/proxy/:sid/mpd` | Internal DASH/MPD proxy for VOD (Widevine) |
| `/api/proxy/:sid/license` | Internal Widevine license proxy for VOD |
| `/api/proxy/:sid/seg` | Internal DASH segment proxy for VOD |
| `/api/iptv/:key/playlist.m3u` | IPTV M3U playlist for external players |
| `/api/iptv/:key/epg.xml` | IPTV EPG (XMLTV) for external players |
| `/api/img` | Image proxy (posters, logos) |
| `/api/proxy/status` | Multi-proxy health (GET = state, POST `{action:"reprobe"}` = force probe). |
| `/api/vpn/status` | VPN/proxy config on disk + multi-proxy health. |
| `/api/vpn/servers` | List of servers parsed from the VLESS subscription (when active). |
| `/api/vpn/preview` | POST `{subscriptionUrl}` → fetch + parse the subscription **without saving** (used by the "Fetch servers" button). |
| `/api/vpn/setup` | POST `{mode:"vless"|"proxy"|"clear", ...}` to switch VPN/proxy at runtime. |
| `/api/vpn/test` | GET = quick probe on the first alive proxy · POST `{proxyUrl?}` = test a specific proxy. |

> `:key` is the addon session key (JWE-encrypted session). `:sid` is a short-lived cache id generated by the addon.

---

## 🧪 Testing

The project uses [Vitest](https://vitest.dev) for unit tests. Tests cover the pure functions: HLS playlist rewriting, MPD helpers, IPTV mapping, ID mapping, manifest URL selection, the short-id cache, the sports data model (team keys, team parsing, status derivation, league normalization, preferences filtering and priority ordering), and the VLESS share-link parser + sing-box config builder.

```bash
npm install
npm test        # run all tests once
npm run test:watch  # watch mode
```

---

## 🤝 Contributing

Contributions are welcome! To contribute:

1. **Fork** the repository
2. **Create** a branch for changes (`git checkout -b feature/your-feature`)
3. **Commit** the changes (`git commit -m 'Added your-feature'`)
4. **Push** to the branch (`git push origin feature/your-feature`)
5. **Open** a Pull Request

### 🐛 Bug Reporting

To report bugs, open an issue including:
- Addon version
- Operating system
- Test URL causing the problem
- Full error log

### 💡 Feature Requests

For new features, open an issue describing:
- Desired functionality
- Specific use case
- Priority (low/medium/high)

---

## ⚖️ Legal Disclaimer
This software is provided for educational and research purposes only. The author does not endorse or encourage any form of piracy or violation of the Terms of Service (ToS) of third-party streaming platforms.

No DRM bypass: This software does not include tools to bypass, remove, or violate DRM protections (such as Widevine). It acts solely as a proxy to forward legitimate requests made by a duly subscribed user.

User Responsibility: The end user is solely responsible for the use of the software and must ensure that their use complies with local laws and the contractual terms of the content provider.

No Warranty: The software is provided “as is,” with no warranties of any kind regarding its operation or stability. The author is not responsible for any account suspensions or damages resulting from the use of this code.

Intellectual Property: All trademarks, service names, and logos (e.g., Paramount+) belong to their respective owners. This project is not affiliated with, authorized by, or endorsed by these entities.

## 📄 License

This project is distributed under the MIT license. See the `LICENSE` file for more details.
