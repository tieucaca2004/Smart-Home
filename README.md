# tieu-home-hub

Central Home Hub backend for Tiểu Home. Node.js + Express, built around an
**Adapter Pattern** so new device protocols (Matter, Zigbee, MQTT, IR, RF)
can be added later without touching routes, services, or the API contract.
Only the **Tuya adapter** is implemented right now, per scope.

This project is separate from, and does not modify, `tuya-package`
(`D:\tuya-client\tuya-package`) — that project stays frozen as the
independently live-tested Tuya baseline (status/ON/OFF/status all verified
against the real device Đèn Quán Quầy, `1638018234ab950e1ecd`, in Cloud
project "Phong Tieu Home"). `tieu-home-hub`'s `TuyaAdapter` reimplements the
same signing algorithm and endpoints as an independent module — it does not
`require()` or edit anything inside `tuya-package`.

## Architecture

```
src/
  adapters/
    DeviceAdapter.js      Abstract base class — the contract every adapter must implement:
                           getDevices(), getDeviceStatus(nativeId), sendCommand(nativeId, code, value)
    AdapterRegistry.js     Maps a protocol name ("tuya", later "matter", "zigbee", ...) to its adapter
                           instance. Namespaced device ids ("tuya:abc123") are parsed/validated here,
                           plus a resolve(deviceId) convenience helper -> { protocol, nativeId, adapter }.
    tuya/
      TuyaAdapter.js       Tuya Cloud OpenAPI implementation of DeviceAdapter (HMAC-SHA256 signing,
                           zero third-party HTTP dependency — only Node's built-in https/crypto).
                           FROZEN this sprint: not modified, live-tested baseline (see below).
      normalizeTuyaErrors.js  Tuya-specific error classification, kept OUTSIDE TuyaAdapter.js on
                           purpose. Wraps a TuyaAdapter instance so getDeviceStatus()/sendCommand()
                           failures carry a protocol-agnostic `.appCode` (AUTH_ERROR, DEVICE_OFFLINE,
                           DEVICE_NOT_FOUND, UPSTREAM_ERROR). Only touches the failure path — success
                           behavior is identical to calling TuyaAdapter directly.
  services/
    deviceService.js       Protocol-agnostic Device Manager used by routes; only talks to
                           AdapterRegistry / DeviceAdapter, never to a specific SDK. Also validates the
                           standardized command shape ({ code, value }) — generic, not Tuya-specific.
  routes/
    devices.js              Express router: GET /, GET /:id/status, POST /:id/commands. Maps a
                           service/adapter error's `.appCode`/`.code` to an HTTP status via the shared
                           error taxonomy (see "Errors" below) — no protocol-specific knowledge here.
  app.js                    Express app factory — takes an already-wired DeviceService (dependency
                           injection), so tests can supply a fake adapter with no real network/credentials.
  bootstrap.js              Wires the REAL adapters for actual use: registers TuyaAdapter wrapped with
                           normalizeTuyaErrors. Add a new protocol adapter here later — nothing else in
                           the codebase needs to change.
  server.js                 Entry point: builds the real DeviceService, builds the app, starts listening.
scripts/
  check-env.js              Read-only .env/process.env diagnostic (existence, length, duplicate/quote
                           checks) — never prints credential values, never modifies anything.
test/
  unit/tuyaAdapter.test.js         Regression suite for TuyaAdapter (signing, request shapes) — UNCHANGED
                                   this sprint, still passing, proves the frozen baseline still behaves
                                   identically. Injected fake HTTP transport, no network, no credentials.
  unit/adapterRegistry.test.js     Namespaced id parsing/validation, register/get/list, resolve().
  unit/normalizeTuyaErrors.test.js Tuya error-code/message -> app taxonomy classification, and that the
                                   wrapper only changes the failure path.
  unit/deviceService.test.js       Multi-device listing (single adapter with 2+ devices, and multiple
                                   adapters), device lookup/routing, command validation, error passthrough.
  api/devices.routes.test.js       In-process HTTP tests of the Express app using a FakeTuyaAdapter —
                                   no network, no real credentials — covers the full error taxonomy's
                                   HTTP status mapping.
```

### Why Adapter Pattern

`DeviceAdapter` defines one contract (`getDevices`, `getDeviceStatus`,
`sendCommand`). `AdapterRegistry` dispatches a namespaced device id like
`tuya:1638018234ab950e1ecd` to the adapter registered for that protocol.
Routes and `deviceService` never know or care which protocol a device
speaks. Adding Matter, Zigbee, MQTT, IR, or RF later means:

1. Write `src/adapters/<protocol>/<Protocol>Adapter.js extends DeviceAdapter`.
2. Add `registry.register(new <Protocol>Adapter())` in `src/bootstrap.js`.

No change to `routes/devices.js`, `services/deviceService.js`, or the public
API shape.

## API

Device ids in the URL/body are namespaced as `<protocol>:<nativeId>`, e.g.
`tuya:1638018234ab950e1ecd`. This API shape is unchanged from the previous
sprint (backward compatible) — only the error responses got more precise.

```
GET  /health
GET  /api/devices
GET  /api/devices/:id/status
POST /api/devices/:id/commands      body: { "code": "switch_1", "value": true }
```

Example:

```bash
curl http://localhost:3000/api/devices
curl http://localhost:3000/api/devices/tuya:1638018234ab950e1ecd/status
curl -X POST http://localhost:3000/api/devices/tuya:1638018234ab950e1ecd/commands \
  -H "Content-Type: application/json" \
  -d '{"code":"switch_1","value":true}'
```

### Errors

Error responses are `{ "error": "<message>", "code": "<TAXONOMY_CODE>", "id": "<deviceId>" }`
(the `error` message never includes a credential — see "Safety"). The taxonomy
is protocol-agnostic; routes/devices.js and DeviceService only ever see these
codes, never a raw Tuya error code:

| HTTP | code | Meaning |
|---|---|---|
| 400 | `INVALID_DEVICE_ID` | id isn't `<protocol>:<nativeId>`, or either half is empty |
| 400 | `UNKNOWN_PROTOCOL` | no adapter registered for that protocol prefix |
| 400 | `INVALID_COMMAND` | request body isn't `{ code: non-empty string, value: <required> }` |
| 404 | `DEVICE_NOT_FOUND` | the adapter/cloud API reports the device doesn't exist |
| 409 | `DEVICE_OFFLINE` | the adapter/cloud API reports the device is offline |
| 500 | `AUTH_ERROR` | the hub's own credential/signing problem at the cloud API — not the caller's fault |
| 502 | `UPSTREAM_ERROR` (or unclassified) | any other adapter/cloud API failure |
| 500 | *(no code)* | unexpected internal error in the hub itself |

For Tuya, `DEVICE_NOT_FOUND`/`DEVICE_OFFLINE`/`AUTH_ERROR` are produced by
`src/adapters/tuya/normalizeTuyaErrors.js` from Tuya's own error code/message
(evidence-based: codes `1004` "sign invalid", `1106` "permission deny", and
`40001900` "No space permission" were all actually observed while debugging
this project's baseline, and are classified as `AUTH_ERROR`; anything else is
matched by keyword or falls back to `UPSTREAM_ERROR`). This classification
module is intentionally separate from `TuyaAdapter.js`, which is not modified.

## Managing multiple devices

Configure as many Tuya device ids as needed, comma-separated, in `.env`:

```bash
TUYA_DEVICE_IDS=1638018234ab950e1ecd,1638018234ab950e241e
```

`TuyaAdapter.getDevices()` fetches "Query Device Details" for every id in
this list, and `DeviceService.listDevices()` aggregates the results from
every registered adapter (today just Tuya; more protocols later) into one
flat array — so `GET /api/devices` already reflects however many devices are
configured, not just one. `GET /:id/status` and `POST /:id/commands` accept
any device id and route it, via `AdapterRegistry.resolve()`, straight to the
matching adapter's `nativeId` — confirmed with tests that address a second,
non-first device correctly (`test/unit/deviceService.test.js`).

A device record's shape is `{ id, nativeId, protocol, name, category, online }`
plus an optional `capabilities` (status-code list) field, passed through
unchanged whenever an adapter provides one — `TuyaAdapter` doesn't populate
`capabilities` yet (it isn't part of "Query Device Details"), but nothing in
`DeviceService`/routes needs to change when an adapter starts supplying it.

## Known limitations (deliberate — not oversights)

- **`GET /api/devices` does not do dynamic discovery.** Tuya's "list all
  devices" endpoints need a linked App-account uid or space id, and a
  space-binding mismatch was the actual root cause of this project's
  earlier `40001900 No space permission` / `1106 permission deny` errors.
  Calling such an endpoint here has not been live-tested, so `TuyaAdapter`
  intentionally avoids it. Instead it reads `TUYA_DEVICE_IDS` (comma
  separated, in `.env`) and calls the already-verified "Query Device
  Details" endpoint (`GET /v2.0/cloud/thing/{id}`) for each one. Real
  discovery is a future task, not implemented here.
- `GET /:id/status` / `POST /:id/commands` do not check the device id
  against `TUYA_DEVICE_IDS` before calling the adapter — any native id the
  Tuya account can see will be forwarded. This was a deliberate choice this
  sprint: gating on a locally cached device list would only be safe if that
  cache were always freshly populated, and requiring an extra list call
  before every status/command call would change the call pattern of the
  already-verified baseline flow. `DEVICE_NOT_FOUND` is therefore reactive
  (based on Tuya's own response), not proactive.
- Only the Tuya adapter exists. Matter/Zigbee/MQTT/IR/RF are structural
  placeholders (see `src/bootstrap.js` comments) — no code for them yet, as
  requested.
- No frontend, no persistence/database, no auth — out of scope for this
  step.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your real TUYA_ACCESS_ID / TUYA_ACCESS_SECRET
```

`.env` is git-ignored. Credentials are never hard-coded — `TuyaAdapter`
throws immediately if `TUYA_ACCESS_ID` / `TUYA_ACCESS_SECRET` are missing.

## Running

```bash
npm run lint        # ESLint (eslint:recommended)
npm test            # unit + API tests — no network, no real credentials needed
npm run test:unit   # TuyaAdapter offline unit tests only
npm run test:api    # Express route tests only (FakeTuyaAdapter)
npm start           # starts the real server on PORT (default 3000) — needs real Tuya credentials
```

All automated tests use an injected fake HTTP transport / a `FakeTuyaAdapter`
— they never call the real Tuya API and never toggle the real device. This
project does not touch, and did not need to touch, the Tuya Developer
Platform or `tuya-package` in any way.

## Verified results (this sprint)

- `npm install` → OK (no new dependencies added — only Node built-ins and
  the existing `express`/`eslint`).
- `npm run lint` → **PASS** (0 errors/warnings).
- `npm run test:unit` → **PASS** — 49/49 assertions across 4 files:
  - `tuyaAdapter.test.js` (unchanged, regression check on the frozen baseline) — 11/11
  - `adapterRegistry.test.js` (new) — 14/14
  - `normalizeTuyaErrors.test.js` (new) — 11/11
  - `deviceService.test.js` (new) — 13/13
- `npm run test:api` → **PASS** — 17/17 assertions (full error-taxonomy HTTP mapping covered).
- `npm test` (both) → **PASS** — 66/66 total.
- `npm start` (real server, real credentials) was **not** run in this
  sandbox — no `TUYA_ACCESS_ID`/`TUYA_ACCESS_SECRET` are available here by
  design. Run it in your own environment once `.env` is filled in.
