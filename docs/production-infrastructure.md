# Production Infrastructure Index

- P.2 dedicated-server profile: [`docs/p-2-production-infrastructure.md`](./p-2-production-infrastructure.md)
- P.2.1 shared-host compatibility: [`docs/p-2-1-existing-server-compatibility.md`](./p-2-1-existing-server-compatibility.md)
- P.3 security audit: [`docs/p-3-security-audit.md`](./p-3-security-audit.md)
- P.3 hardening: [`docs/p-3-security-hardening.md`](./p-3-security-hardening.md)
- Environment inventory: [`docs/production-environment.md`](./production-environment.md)
- Security operations: [`docs/production-security-operations.md`](./production-security-operations.md)
- Deployment runbook: [`docs/production-deployment.md`](./production-deployment.md)
- Rollback runbook: [`docs/production-rollback.md`](./production-rollback.md)

## Deployment profiles

| Mode | Compose file | Public entry | Project name |
|---|---|---|---|
| `dedicated` | `infra/production/compose.yaml` | Container Nginx `:80/:443` | `hector-production` |
| `shared-host` | `infra/production/compose.shared-host.yaml` | Host Nginx → `127.0.0.1:3100/3101` | `hector` |

Set `DEPLOYMENT_MODE` explicitly. Production scripts refuse ambiguous defaults.

Artifacts: `infra/production/`, `apps/*/Dockerfile`, `infra/production/host-nginx/`.
