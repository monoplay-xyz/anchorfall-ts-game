# Public deployment (community server)

The game ships as a single Node service — `server.js` serves the client,
the WebSocket rooms, and the rankings REST API. One small instance runs a
whole community: the sim is ~1ms/tick per room and snapshots are
interest-managed.

## Railway (recommended)

One-time setup from the repo root:

```sh
railway login                 # opens the browser once
railway init                  # create the project (pick a name)
railway up                    # build the Dockerfile and deploy
railway volume add --mount-path /data    # rankings survive redeploys
railway domain                # get the public https URL
```

Later deploys are just `railway up` (or connect the GitHub repo in the
dashboard for deploy-on-push — set the service root directory to
`/`, the repo root).

### Accounts + database (optional)

Accounts are optional — anonymous couch/online play works with no database.
To enable cross-device sync of operators + milestone progress:

```sh
railway add --database postgres        # provisions Postgres, sets DATABASE_URL
railway variables --set SESSION_SECRET=$(openssl rand -hex 32)
railway up
```

The server reads two env vars:

- **`DATABASE_URL`** — a Postgres connection string. When set, accounts +
  cloud profiles use Postgres (tables `users` + `profiles` are created on
  boot); TLS is negotiated automatically for managed databases. When unset,
  the server falls back to a local JSON file under `SAVES_DIR` (fine for a
  single LAN box, not for the public internet).
- **`SESSION_SECRET`** — a long random string that signs session cookies.
  **Set this in production** (e.g. `openssl rand -hex 32`); without it the
  server uses an ephemeral secret and every login drops on restart.

Security: passwords are hashed with scrypt + a per-user random salt (never
stored or logged in plaintext); sessions are HMAC-signed, HttpOnly,
SameSite=Lax, `Secure` under `PUBLIC_DEPLOY=1`; all DB access is
parameterized; register/login are rate limited per IP.

## Any other host (Fly, Render, a VPS)

Run the container with a persistent dir mounted at `/data`:

```sh
docker build -t anchorfall .
docker run -p 3001:3001 -v anchorfall-saves:/data anchorfall
```

Or skip Docker entirely: `PUBLIC_DEPLOY=1 SAVES_DIR=/data node server.js`
behind any TLS-terminating proxy.

## What PUBLIC_DEPLOY=1 changes

Hardening for the open internet — without it the server behaves exactly
like the couch/LAN build:

- the lobby message omits the server's LAN URL
- the `HOLDOUT_SMOKE` debug hooks are dead even if the env var is set
- client IPs come from `X-Forwarded-For` (trust-proxy), so per-IP rate
  limits see real players instead of the platform proxy

Always on (any mode): WebSocket payload caps, ping/pong keepalive that
drops dead connections, per-IP connection caps, a global room cap,
per-connection message-rate limiting, and name/input sanitation.

## Notes

- **Privacy**: strictly client-server — players never learn each other's
  IPs. Without a database the server stores only typed player names, scores
  and times (rankings). With accounts enabled it additionally stores a
  username, a scrypt password hash, and that account's milestone profile —
  nothing else, no tracking, no third parties.
- **TLS**: Railway/Fly/Render terminate HTTPS/WSS at their edge; the
  client uses relative URLs and `wss:` automatically on https pages.
- **Scaling**: one instance only (rooms live in process memory). Vertical
  scaling is plenty; do not run replicas behind one domain.
