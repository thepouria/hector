# Hector — Simple production deployment

Shared Ubuntu host. Docker Compose for Postgres + API + Web. Host Nginx for TLS.

**Env file:** `/opt/hector/env/production.env` (mode `0600`)  
**App dir:** `/opt/hector/app`  
**Compose:** `docker compose -p hector -f infra/production/compose.shared-host.yaml --env-file /opt/hector/env/production.env`

Do not modify Bazarbashe / Fanoma sites, volumes, or containers.

---

## First install

```bash
sudo mkdir -p /opt/hector/env /var/backups/hector
sudo chmod 700 /opt/hector/env /var/backups/hector

# Clone (or rsync) the repo
sudo git clone <YOUR_HECTOR_GIT_URL> /opt/hector/app
cd /opt/hector/app

sudo cp infra/production/env/production.env.example /opt/hector/env/production.env
sudo chmod 600 /opt/hector/env/production.env
sudo nano /opt/hector/env/production.env
# Fill: JWT_ACCESS_SECRET, AUTH_REFRESH_PEPPER, POSTGRES_PASSWORD,
# DATABASE_URL, DATABASE_URL_MIGRATE (same hector_app password for first boot),
# CORS_ORIGINS=https://hector.pishete.com, DEPLOYMENT_MODE=shared-host
# Leave HECTOR_BACKUP_GATE as-is; install.sh handles the gate.

./deploy/install.sh
```

Install will: check env/ports → build local images (`hector-*:latest`) → start Postgres → backup → migrate → start API/Web → bootstrap OWNER → Nginx → Certbot HTTPS.

If Certbot is missing, install stops after HTTP Nginx with install instructions.

---

## Future updates

```bash
cd /opt/hector/app
./deploy/update.sh
```

Update will: `git pull --ff-only` → build → backup → migrate → recreate API/Web → health check.

Requires a clean git working tree (no `git reset --hard` from the script).

---

## Status

```bash
cd /opt/hector/app
docker compose -p hector \
  -f infra/production/compose.shared-host.yaml \
  --env-file /opt/hector/env/production.env \
  ps
```

---

## Logs

```bash
docker compose -p hector \
  -f infra/production/compose.shared-host.yaml \
  --env-file /opt/hector/env/production.env \
  logs -f api web postgres
```

---

## Backup

```bash
cd /opt/hector/app
export DEPLOYMENT_MODE=shared-host
export HECTOR_ENV_FILE=/opt/hector/env/production.env
./infra/production/scripts/backup.sh
```

Daily cron can be installed with `./infra/production/scripts/install-backup-cron.sh --install`.

Same-server backups do **not** protect against full disk/server loss — copy dumps off-box when you can.

---

## Restore (verify only — never over live by default)

```bash
./infra/production/scripts/restore-verify.sh /var/backups/hector/daily/<file>.dump
```

Live restore is a manual, approved operation — see `docs/production-backup-restore.md`.

---

## App rollback (images only)

After an update, previous images are tagged `:previous`:

```bash
docker tag hector-api:previous hector-api:latest
docker tag hector-web:previous hector-web:latest
docker compose -p hector \
  -f infra/production/compose.shared-host.yaml \
  --env-file /opt/hector/env/production.env \
  up -d --force-recreate --no-deps api web
```

Does **not** reverse Prisma migrations or restore the database.

---

## If install fails

| Symptom | Action |
|---|---|
| Missing env / placeholders | Edit `/opt/hector/env/production.env` |
| Ports 3100/3101 busy | Stop conflicting process or change ports in env (and Nginx) |
| Build OOM | Free RAM; retry; or build on a laptop and `docker load` `:latest` tags |
| Migrate fails | Fix error; do **not** `migrate reset`; re-run install/update |
| nginx -t fails | Hector site backups are `*.bak.*` under sites-available |
| Certbot missing | `sudo apt-get install -y certbot` then re-run `./deploy/install.sh` |
