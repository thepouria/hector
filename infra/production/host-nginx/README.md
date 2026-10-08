# Host Nginx templates (shared-host profile)

These files are **templates only**. Do not install them on `62.60.191.119` during P.2.1.

## Intended install path (future deploy)

- `/etc/nginx/sites-available/hector.pishete.com`
- `/etc/nginx/sites-available/core-hector.pishete.com`

Symlink into `sites-enabled` after `nginx -t` succeeds.

## Safety

- Additive only — never replace `/etc/nginx/nginx.conf`
- Never modify `bazarbashe` or `office.fanoma.ir` sites
- No `default_server`
- Exact `server_name` only (no wildcards)
- HTTP-first bootstrap; HTTPS templates require real cert files

## Upstream ports

| Domain | Upstream |
|---|---|
| `hector.pishete.com` | `127.0.0.1:3100` |
| `core-hector.pishete.com` | `127.0.0.1:3101` |

If `HECTOR_WEB_HOST_PORT` / `HECTOR_API_HOST_PORT` change, update these templates to match.
