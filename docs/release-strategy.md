# Release Strategy (Rolling + Canary) & Probes Notes

## Rolling Update

- readinessProbe gates traffic: new pods must be ready before receiving requests
- maxUnavailable=0 + maxSurge=1: safer rollout, avoid capacity drop
- livenessProbe: restart stuck process; readiness stays stricter to prevent bad traffic

Rollback:

- `kubectl rollout undo deploy/api -n sb-ledger`

## Canary (Replica-based)

- Deploy `api-canary` with same Service selector (`app=api`)
- Control traffic by replica ratio (e.g., 1 canary : 4 stable ~= 20%)
- Quick rollback by scaling canary to 0

Why this approach:

- Simple, no extra ingress controller required for demo
- Easy to explain; production may use service mesh / ingress weighted routing
