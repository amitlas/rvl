# rvl - working notes

This repo is the Chrome extension only.

## The key service lives in unishit

The provider-key service (device approval, per-client and global keys, the admin
page) is **not** in this repo. It runs in the unishit Worker, under `/rvl`:

- Code: `~/dev/apps/unishit/worker/src/rvl/` (`handler.js`, `registry.js`, `admin-page.js`)
- Admin UI: the "rvl" tab of the owner `/admin` screen in unishit, served from `/rvl/admin`.
- Secrets live on the unishit Worker (`RVL_*`), not here.

## The contract (change both sides together)

The extension (`src/remote-keys.js`) calls `https://unishit-worker.lasry1.workers.dev/rvl` with:
- `GET /status` and `GET /keys`, with the header `X-Device-Id`
- `POST /register` with `{ deviceId, name }`

Responses it relies on: `{status}` from `/status`; `{status, keys}` from `/keys` (keys only when
approved); `403 {status: "unknown"|"pending"|"revoked"}` when not allowed.

If you rename a path, a header, a field, or a status value, change `src/remote-keys.js` here AND
`worker/src/rvl/handler.js` in unishit in the same change, then bump the version here.

## Versions

Every finished change bumps the minor version in `manifest.json` and `package.json`.
