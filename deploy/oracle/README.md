# Deploy su Oracle Cloud Free Tier (Oracle Linux 9 o Ubuntu 22.04/24.04 LTS, VM.Standard.A1.Flex)

Setup **Docker-first**: l'addon gira in un container Docker con `docker compose`, immagine multi-stage ottimizzata, utente non-root, volume named per i dati persistenti e healthcheck automatico. Il deploy è un singolo script idempotente.

> **Alternativa bare-metal** (senza Docker, servizio `systemd`): vedi [sezione 7](#7-alternativa-bare-metal-systemd). Docker è il percorso consigliato: setup più pulito, aggiornamenti più semplici, nessuna dipendenza Node.js sull'host.

L'installer [`scripts/deploy-docker.sh`](../../scripts/deploy-docker.sh) rileva automaticamente il package manager: **Oracle Linux / RHEL / Fedora** → `dnf`; **Ubuntu / Debian** → `apt`. Entrambe le distro sono ufficialmente supportate sulle VM Always Free di Oracle Cloud.

## Perché Oracle Cloud Free Tier?

- **Always Free**: 4 OCPU + 24 GB RAM totali nella tenancy, configurabili come 1×4 OCPU/24 GB oppure 4×1 OCPU/6 GB su VM.A1.Flex (ARM/Ampere A1).
- **IP pubblico statico** incluso, traffico in uscita 10 TB/mese gratis.
- Con **2 OCPU + 12 GB RAM** (o più) il container (≈ 150 MB RSS + proxy HLS) e la build Docker girano senza swap. Con **1 GB RAM** è necessario aggiungere 2 GB di swap per la build.

## 0. Prerequisiti sulla VM

Hai già:
- ✅ VM ARM/Ampere A1 con **Oracle Linux 9** oppure **Ubuntu 22.04/24.04 LTS**
- ✅ IP pubblico (es. `123.45.67.89`)
- ✅ Porte **7850** (o 80/443 se metti davanti nginx) aperte nella **Security List** della subnet
- ✅ Chiave SSH per accedere come `opc` (Oracle Linux) oppure `ubuntu` (Ubuntu)

### Swap (serve solo su VM con 1 GB RAM, opzionale su 2+ GB)

Se la tua VM ha **2 GB RAM o più** (es. shape 2 OCPU + 12 GB), salta questa sezione: la build Docker ci sta dentro senza problemi.

Se invece hai una VM piccola da **1 GB RAM** (shape 1 OCPU + 6 GB Always Free), la build Docker può andare in OOM. Aggiungi 2 GB di swap con lo script dedicato (auto-rileva distro, idempotente):

```bash
sudo bash scripts/setup-swap.sh
free -h   # conferma che vedi ~2G di swap
```

### Aprire la porta 7850 nella Oracle Security List

Dashboard → **Networking → Virtual Cloud Networks** → la tua VCN → **Subnets** → la subnet → **Security Lists** → Default Security List → **Add Ingress Rule**:

| Campo | Valore |
|-------|--------|
| Source CIDR | `0.0.0.0/0` |
| Protocol | TCP |
| Destination Port | `7850` |

> Per maggiore sicurezza apri solo la 80/443 e metti nginx davanti. Vedi sezione "Opzionale: nginx + HTTPS".

### Firewall interno (Ubuntu lo attivo di default)

Ubuntu 22.04+ ha **UFW** attivo. Apri la porta 7850 anche lì:

```bash
sudo ufw allow 7850/tcp
sudo ufw reload
```

Oracle Linux di solito non ha `firewalld` attivo sulle immagini cloud, ma se presente:

```bash
sudo firewall-cmd --add-port=7850/tcp --permanent
sudo firewall-cmd --reload
```

## 1. Installazione (Docker)

Dalla tua macchina locale (o direttamente sulla VM via SSH):

```bash
# Oracle Linux:  ssh opc@<pub-ip>
# Ubuntu:        ssh ubuntu@<pub-ip>
ssh <user>@<pub-ip>

# (opzionale, solo se VM con 1 GB RAM)
# sudo bash scripts/setup-swap.sh

cd /opt/paramount-stremio         # se hai già clonato qui
sudo bash scripts/deploy-docker.sh
```

> Se non hai ancora clonato il repo sulla VM: `sudo git clone https://github.com/superaprile98/paramount-stremio-v2.git /opt/paramount-stremio && cd /opt/paramount-stremio`.

Lo script:
1. Rileva `dnf` o `apt` automaticamente
2. Installa **Docker Engine + compose plugin** (via script ufficiale `get.docker.com`)
3. Aggiunge l'utente al gruppo `docker` (ri-login per usare docker senza sudo)
4. Clona/aggiorna il repo in `/opt/paramount-stremio`
5. Crea `.env` da `.env.example` e genera `KEY_SECRET` (se mancante)
6. `docker compose up -d --build`
7. Attende l'healthcheck (`/api/health`) e stampa l'URL finale

### Verifica

```bash
docker compose ps                  # STATUS deve essere "Up" e HEALTH "healthy"
docker compose logs -f             # log live
curl http://<pub-ip>:7850/configure   # deve rispondere HTML
```

Apri `http://<pub-ip>:7850/configure` nel browser → segui il flusso di login Paramount.

## 2. Aggiornamenti (Docker)

Dopo un `git push` sul branch `main`:

```bash
ssh <user>@<pub-ip>
cd /opt/paramount-stremio
sudo bash scripts/update-docker.sh
```

Lo script fa fetch, `docker compose up -d --build` e attende l'healthcheck. **I dati persistenti (volume named `paramount-data`) non vengono toccati**: prefs e login restano intatti. Tempo tipico: 1-3 minuti.

## 3. Operazioni comuni (Docker)

| Operazione | Comando |
|------------|---------|
| Stato container | `docker compose ps` |
| Log live | `docker compose logs -f` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` |
| Stop + rimozione volume dati | `docker compose down -v` ⚠️ cancella prefs e login |
| Modificare env | `sudo nano /opt/paramount-stremio/.env && sudo bash scripts/update-docker.sh` |
| Backup dati | `docker run --rm -v paramount-data:/data -v "$PWD":/backup alpine tar czf /backup/paramount-data.tar.gz -C /data .` |
| Pulire immagini vecchie | `docker image prune -f` |

## 4. Troubleshooting

### Build Docker uccisa da OOM (Exit 137)

Hai solo 1 GB RAM e nessuno swap attivo. Aggiungi swap (vedi sezione 0). Su VM con 2+ GB RAM questo problema non si presenta.

### La porta 7850 non risponde dall'esterno

1. Controlla il Security List: la porta 7850 è aperta in ingress?
2. **Ubuntu** — controlla UFW: `sudo ufw status` → se attivo, `sudo ufw allow 7850/tcp`
3. **Oracle Linux** — controlla `firewalld`: `sudo firewall-cmd --list-all`
4. Controlla che il container sia in ascolto: `docker compose ps` e `sudo ss -tlnp | grep 7850`

### Container "unhealthy" o in crash-loop

```bash
docker compose logs --tail=100   # guarda l'errore
docker compose ps                # stato attuale
```

Cause comuni:
- `KEY_SECRET` mancante o placeholder (`change-me`) → il container fallisce all'avvio. Imposta una chiave reale in `.env` e rilancia `sudo bash scripts/update-docker.sh`.
- Porta già occupata da un altro processo → cambia `PORT` in `.env`.

### Il banner in `/configure` mostra ancora "Local address detected"

Hai dimenticato di impostare `BASE_URL` nel `.env`. Modifica `/opt/paramount-stremio/.env`:

```
BASE_URL=http://<pub-ip>:7850
```

Poi `sudo bash scripts/update-docker.sh`.

### `/configure` mostra "Open in Stremio" non funzionante

Stai navigando su `http://` ma Stremio desktop può avere problemi con HTTP (mixed content se apri il link da una pagina HTTPS). Soluzioni:

- Usa **HTTPS** (sezione 5 sotto).
- Oppure apri Stremio desktop e aggiungi manualmente l'addon via URL.

### 5a. Se usi Nginx Proxy Manager (consigliato)

Se hai già NPM installato sulla stessa VPS via `docker compose` (tipicamente in una cartella `server-stack/`), `docker-compose.yml` è già configurato per collegarsi alla network `server-stack_default` di NPM.

1. Verifica network: `sudo docker network ls | grep server-stack_default`
2. Ricostruisci Paramount: `cd /opt/paramount-stremio && sudo docker compose up -d --build`
3. In NPM → **Hosts → Add Proxy Host**:
   - **Domain Names**: `<tuo-dominio-duckdns>`
   - **Forward Hostname/IP**: `paramount-stremio` (nome del container, non IP)
   - **Forward Port**: `7850`
   - **SSL**: Request a new Let's Encrypt certificate
4. Aggiorna `BASE_URL=https://<tuo-dominio-duckdns>` in `.env` e `sudo docker compose up -d`.

> Se non usi NPM o la network Docker ha un nome diverso, commenta le righe `server-stack_default` in `docker-compose.yml` (in `services.paramount.networks` e in `networks:` in fondo) e usa come Forward Hostname/IP `10.0.0.151` (IP privato della VM).

### 5.1 Alternativa: nginx puro + Let's Encrypt (senza NPM)

Per HTTPS pubblico, metti nginx davanti al container:

```bash
# Ubuntu
sudo apt install -y nginx certbot python3-certbot-nginx
# Oracle Linux
sudo dnf install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/conf.d/paramount-stremio.conf`:

```nginx
server {
    listen 80;
    server_name addon.example.com;

    location / {
        proxy_pass http://127.0.0.1:7850;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 60s;
    }
}
```

```bash
sudo systemctl enable --now nginx
sudo certbot --nginx -d addon.example.com
sudo systemctl restart nginx
```

Poi aggiorna `BASE_URL=https://addon.example.com` in `/opt/paramount-stremio/.env` e apri la porta 80+443 invece della 7850 nella Security List.

## 6. Persistenza dei dati

Tutti i dati persistenti vivono nel **volume named `paramount-data`** montato su `/app/.data`:

- **Prefs sportive** (squadre preferite, leghe nascoste) → `/app/.data/prefs/sport-prefs.json`
- **Login Paramount** → la sessione è un token JWE cifrato con `KEY_SECRET` (non un file su disco): finché `KEY_SECRET` non cambia, l'utente resta loggato anche dopo restart/rebuild.

Il volume sopravvive a `docker compose down`, `up -d --build` e `update-docker.sh`. Viene cancellato solo con `docker compose down -v`.

Per fare un backup:

```bash
docker run --rm -v paramount-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/paramount-data.tar.gz -C /data .
```

> ⚠️ Se cambi `KEY_SECRET` nel `.env`, i login esistenti diventano illeggibili: l'utente dovrà rifare il login da `/configure`.

## 7. Alternativa bare-metal (systemd)

Se preferisci **non usare Docker** (es. VM da 1 GB RAM senza swap), esiste il percorso bare-metal con Node.js 20 LTS e servizio `systemd`:

```bash
cd /opt/paramount-stremio
sudo bash scripts/install-oracle.sh     # installa Node.js, crea utente 'addon', systemd unit
sudo bash scripts/update-oracle.sh      # aggiornamenti successivi
```

Differenze rispetto a Docker:

| | Docker (consigliato) | Bare-metal |
|---|---|---|
| Dipendenze sull'host | Solo Docker Engine | Node.js 20 + git |
| Isolamento | Container non-root, `cap_drop: ALL` | Utente di sistema `addon` |
| Persistenza | Volume named `paramount-data` | `/opt/paramount-stremio/.data` |
| Aggiornamento | `update-docker.sh` (rebuild immagine) | `update-oracle.sh` (npm ci + next build) |
| Log | `docker compose logs -f` | `journalctl -u paramount-stremio -f` |
| Porta di default | `7850` | `3000` |

La configurazione nginx (sezione 5) è identica, cambia solo la porta di `proxy_pass` (`3000` per bare-metal).
