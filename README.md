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
                           getDevices(), getDeviceStatus(nativeId), getDeviceCapabilities(nativeId),
                           sendCommand(nativeId, code, value)
    AdapterRegistry.js     Maps a protocol name ("tuya", later "matter", "zigbee", ...) to its adapter
                           instance. Namespaced device ids ("tuya:abc123") are parsed/validated here,
                           plus a resolve(deviceId) convenience helper -> { protocol, nativeId, adapter }.
    tuya/
      TuyaAdapter.js       Tuya Cloud OpenAPI implementation of DeviceAdapter (HMAC-SHA256 signing,
                           zero third-party HTTP dependency — only Node's built-in https/crypto).
                           Signing, _call(), getDevices(), getDeviceStatus() and sendCommand() are the
                           FROZEN, live-tested baseline and are unchanged. This sprint only ADDED
                           getDeviceCapabilities() (read-only) — see "Capabilities" below.
      normalizeTuyaCapabilities.js  Pure, I/O-free parsing of Tuya's device specification response into
                           the protocol-neutral capabilities shape (kept OUTSIDE TuyaAdapter.js, like
                           normalizeTuyaErrors.js).
      normalizeTuyaErrors.js  Tuya-specific error classification, kept OUTSIDE TuyaAdapter.js on
                           purpose. Wraps a TuyaAdapter instance so getDeviceStatus()/sendCommand()/
                           getDeviceCapabilities() failures carry a protocol-agnostic `.appCode`
                           (AUTH_ERROR, DEVICE_OFFLINE, DEVICE_NOT_FOUND, UPSTREAM_ERROR). Only touches
                           the failure path — success behavior is identical to calling TuyaAdapter directly.
      TuyaDiscoveryAdapter.js  TuyaAdapter + device discovery: overrides only getDevices() to also list every
                           device the Tuya Cloud project can see (see "Device discovery"). TuyaAdapter.js is unchanged.
  services/
    deviceService.js       Protocol-agnostic Device Manager used by routes; only talks to
                           AdapterRegistry / DeviceAdapter, never to a specific SDK. Also validates the
                           standardized command shape ({ code, value }) — generic, not Tuya-specific.
  routes/
    devices.js              Express router: GET /, GET /:id/status, GET /:id/capabilities,
                           POST /:id/commands. Maps a
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
  unit/tuyaCapabilities.test.js    TuyaAdapter.getDeviceCapabilities() request construction, response
                                   normalization, error tagging via the wrapper, no credential leakage.
  unit/deviceServiceCapabilities.test.js  DeviceService.getDeviceCapabilities(): routing, identity fields,
                                   INVALID_DEVICE_ID / UNKNOWN_PROTOCOL, adapter error propagation.
  unit/startupEnv.test.js          `npm start` env loading: boots the Hub with the literal start command in a
                                   throwaway temp dir (dummy credentials, never touches a real .env) —
                                   .env loading, CRLF, env-over-file precedence, missing .env, engines floor.
  unit/tuyaDiscovery.test.js       TuyaDiscoveryAdapter: paging, merge with TUYA_DEVICE_IDS, field whitelist (no local_key /
                                   ip / uid), refused discovery falls back, TUYA_DISCOVERY=off. Fake transport.
  api/discovery.routes.test.js     GET /api/devices end to end with discovery (real stack, fake transport): all devices
                                   listed, offline kept, per-device routes work for a discovered device, no leaks.
  api/capabilities.routes.test.js  GET /:id/capabilities over HTTP: once with a fake adapter (shape + full
                                   error mapping) and once end-to-end through the REAL TuyaAdapter + error
                                   wrapper on a fake transport, asserting no secret/token/signature can
                                   appear in any response body.
```

The pre-existing test files above (the first five) were not edited this sprint.

### Why Adapter Pattern

`DeviceAdapter` defines one contract (`getDevices`, `getDeviceStatus`,
`getDeviceCapabilities`, `sendCommand`). `AdapterRegistry` dispatches a namespaced device id like
`tuya:1638018234ab950e1ecd` to the adapter registered for that protocol.
Routes and `deviceService` never know or care which protocol a device
speaks. Adding Matter, Zigbee, MQTT, IR, or RF later means:

1. Write `src/adapters/<protocol>/<Protocol>Adapter.js extends DeviceAdapter`.
2. Add `registry.register(new <Protocol>Adapter())` in `src/bootstrap.js`.

No change to `routes/devices.js`, `services/deviceService.js`, or the public
API shape.

## API

Device ids in the URL/body are namespaced as `<protocol>:<nativeId>`, e.g.
`tuya:1638018234ab950e1ecd`. The three pre-existing endpoints are unchanged
(backward compatible); `GET /api/devices/:id/capabilities` is the only
addition this sprint.

```
GET  /health
GET  /api/devices
GET  /api/devices/:id/status
GET  /api/devices/:id/capabilities
POST /api/devices/:id/commands      body: { "code": "switch_1", "value": true }
```

Example:

```bash
curl http://localhost:3000/api/devices
curl http://localhost:3000/api/devices/tuya:1638018234ab950e1ecd/status
curl http://localhost:3000/api/devices/tuya:1638018234ab950e1ecd/capabilities
curl -X POST http://localhost:3000/api/devices/tuya:1638018234ab950e1ecd/commands \
  -H "Content-Type: application/json" \
  -d '{"code":"switch_1","value":true}'
```

### Response shapes

Field values below are **illustrative** (the shapes are taken from the code and
its tests); real values come from your devices.

`GET /api/devices` — a flat list across all registered adapters. A device whose
lookup failed is still listed, with an `error` string instead of name/category/online:

```json
{
  "devices": [
    { "id": "tuya:1638018234ab950e1ecd", "nativeId": "1638018234ab950e1ecd", "protocol": "tuya",
      "name": "Đèn Quán Quầy", "category": "kg", "online": true },
    { "id": "tuya:some-other-id", "nativeId": "some-other-id", "protocol": "tuya",
      "error": "Tuya API error on GET /v2.0/cloud/thing/some-other-id: code=... msg=..." }
  ]
}
```

`GET /api/devices/:id/status`:

```json
{ "id": "tuya:1638018234ab950e1ecd", "status": [ { "code": "switch_1", "value": false } ] }
```

`POST /api/devices/:id/commands` — `result` is whatever the adapter returns (for
Tuya, `true` means the cloud accepted the command; re-read status to confirm the
device's actual state, which is how the baseline was verified):

```json
{ "id": "tuya:1638018234ab950e1ecd", "code": "switch_1", "value": true, "result": true }
```

### Capabilities

`GET /api/devices/:id/capabilities` is **read-only**. It reports what the
protocol itself says the device supports — the hub never invents a capability.

```json
{
  "id": "tuya:1638018234ab950e1ecd",
  "capabilities": {
    "id": "tuya:1638018234ab950e1ecd",
    "protocol": "tuya",
    "nativeId": "1638018234ab950e1ecd",
    "name": "Đèn Quán Quầy",
    "category": "kg",
    "online": true,
    "commands": [
      { "code": "switch_1", "type": "Boolean", "name": "Switch 1", "values": {} },
      { "code": "countdown_1", "type": "Integer", "name": "Countdown 1",
        "values": { "unit": "s", "min": 0, "max": 86400, "scale": 0, "step": 1 } }
    ],
    "statuses": [
      { "code": "switch_1", "type": "Boolean", "name": "Switch 1", "values": {} }
    ]
  }
}
```

(The example above is synthetic, shaped after Tuya's documented response. The
real device's actual specification has not been recorded in this repository.)

| Field | Meaning |
|---|---|
| `id`, `protocol`, `nativeId` | Always present; derived by the hub from the requested id, never from the adapter. |
| `name`, `category`, `online` | Present only when the protocol supplies them; otherwise omitted (not `null`). |
| `commands[]` | Codes the device accepts via `POST .../commands`. Always an array (may be empty). |
| `statuses[]` | Codes the device reports via `GET .../status`. Always an array (may be empty). |
| `commands[].type` / `statuses[].type` | The protocol's own type name, passed through (for Tuya: `Boolean`, `Integer`, `Enum`, …). |
| `commands[].values` | Parsed constraint object (e.g. `range`, `min`/`max`/`step`/`unit`). `{}` means no constraints; `null` means the protocol sent something that could not be parsed. |
| `name` / `desc` on an entry | Included only when non-empty. |

How it works for Tuya (`TuyaAdapter.getDeviceCapabilities`): one call to
`GET /v1.0/iot-03/devices/{id}/specification` (Tuya's "Get the specifications and
properties of the device", the source of `category`, `commands`, `statuses`),
plus the already-verified `GET /v2.0/cloud/thing/{id}` "Query Device Details"
call for `name`/`online`. The details call is best-effort: if it fails, those
two fields are omitted and the response is still `200`. If the specification
call fails, the error is normalized (see below). No command is ever sent.

**Verification status:** `GET /api/devices/tuya:1638018234ab950e1ecd/capabilities`
has been called against the **real Tuya cloud** and returned the actual
capabilities of the real device (W-W603 2). The call is read-only. The example
response above and the fixtures in the tests remain synthetic.

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
| 502 | `UPSTREAM_ERROR` (or unclassified) | any other adapter/cloud API failure — also returned by `/capabilities` when the device's adapter doesn't implement capabilities |
| 500 | *(no code)* | unexpected internal error in the hub itself (e.g. `GET /api/devices` failing outright) |

The taxonomy is unchanged this sprint; `/status`, `/capabilities` and
`/commands` all use it identically. Client code should branch on `code`, never
on the `error` message text. Example (`GET .../capabilities` on a device the
cloud says is offline → `409`):

```json
{ "error": "Tuya API error on GET /v1.0/iot-03/devices/x/specification: code=... msg=...",
  "code": "DEVICE_OFFLINE", "id": "tuya:x" }
```

For Tuya, `DEVICE_NOT_FOUND`/`DEVICE_OFFLINE`/`AUTH_ERROR` are produced by
`src/adapters/tuya/normalizeTuyaErrors.js` from Tuya's own error code/message
(evidence-based: codes `1004` "sign invalid", `1106` "permission deny", and
`40001900` "No space permission" were all actually observed while debugging
this project's baseline, and are classified as `AUTH_ERROR`; anything else is
matched by keyword or falls back to `UPSTREAM_ERROR`). This classification
module is intentionally separate from `TuyaAdapter.js`, which is not modified.

## Device discovery

`GET /api/devices` lists every device the Tuya Cloud project can see: the
Hub calls Tuya's "Batch query for the list of associated App user dimension
devices" (`GET /v1.0/iot-01/associated-users/devices`, paged) and returns each
device as `{ id, nativeId, protocol, name, category, online }`. Only those fields
are copied from Tuya's answer, which also carries the device `local_key`, IP and
account uid; none of that ever reaches a response.

- It lives in `src/adapters/tuya/TuyaDiscoveryAdapter.js`, a subclass of
  `TuyaAdapter` that overrides only `getDevices()`. `TuyaAdapter.js` is unchanged,
  and status / capabilities / commands are inherited as they were.
- Ids in `TUYA_DEVICE_IDS` are still looked up one by one (the original path) and
  listed first; a device that is both configured and discovered appears once.
- Discovery is read-only and best-effort. If Tuya refuses it, the Hub logs
  `Tuya device discovery failed; ...` with Tuya's reason and lists only the
  configured devices, as before.
- `TUYA_DISCOVERY=off` (also `false`, `0`, `no`) turns discovery off.

Check it against your own project (read-only) after starting the Hub:

```bash
curl http://localhost:3000/api/devices
```

The number of entries should match the devices linked to the project in the Tuya
console (Cloud -> project -> Devices). If you still get only your
`TUYA_DEVICE_IDS`, look for the `discovery failed` line in the Hub's console.

## Managing multiple devices

With discovery on (the default) nothing needs configuring. To pin devices
explicitly as well, list their ids comma-separated in `.env`:

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

## How a future mobile app should talk to the Hub

The app talks **only** to this Hub's REST API over HTTP/JSON — never to Tuya
directly, and never holding any Tuya credential (those live only in the Hub's
`.env`). There is no auth and no TLS in the Hub today, so run it on a trusted
network (or behind something that adds both) until that's built. A sensible
client flow using only what exists now:

1. **Discover** — `GET /api/devices` → list of `{ id, name, category, online, ... }`.
   Treat `id` as an opaque string (`<protocol>:<nativeId>`) and echo it back
   unchanged in later calls; don't parse or construct it client-side.
2. **Build the screen** — `GET /api/devices/:id/capabilities` once per device
   (cache it client-side; it rarely changes). Render a control only for codes
   present in `commands[]`, and use `type` / `values` to pick the widget
   (e.g. `Boolean` → switch, `Enum` with `values.range` → picker, `Integer` with
   `min`/`max`/`step` → slider). Codes in `statuses[]` but not in `commands[]`
   are read-only.
3. **Read state** — `GET /api/devices/:id/status`. Poll it; there is no push.
4. **Act** — `POST /api/devices/:id/commands` with `{ "code", "value" }` using a
   code from `commands[]` and a value of the matching type. A `200` means the
   cloud accepted the command; confirm by re-reading status.
5. **Handle failures by `code`** (see the error table): show "device offline" on
   `DEVICE_OFFLINE` (409), retry/back off on `UPSTREAM_ERROR` (502), and treat
   `AUTH_ERROR` (500) as a Hub configuration problem, not a user error.
   `INVALID_*`/`UNKNOWN_PROTOCOL` (400) indicate a client bug.

## Mobile app

`mobile/` contains the Flutter app **Tiểu Home** (Android + iOS). It is a client
of this Hub's REST API only — it never talks to Tuya or holds any credential.
It shows the device list (`GET /api/devices`) and a device detail
(`GET /api/devices/:id/capabilities`) with on/off switches for the device's
Boolean commands, sent through `POST /api/devices/:id/commands` and confirmed
by reading `GET /api/devices/:id/status`.

Point it at the Hub with `--dart-define=HUB_BASE_URL=http://<hub-lan-ip>:3000`
(defaults: `http://10.0.2.2:3000` on the Android emulator,
`http://localhost:3000` elsewhere). Setup, platform settings and the test
commands are in [`mobile/README.md`](mobile/README.md). The Hub is unchanged by
the app: `npm test` and `npm run lint` do not touch `mobile/`.

## Known limitations (deliberate — not oversights)

- **Device discovery is new and has not been live-tested by this project.**
  `GET /api/devices` also lists every device the Tuya Cloud project can see, via
  `GET /v1.0/iot-01/associated-users/devices` (see "Device discovery"). Earlier
  sprints avoided list endpoints because a space-binding mismatch caused the
  `40001900 No space permission` / `1106 permission deny` errors; if Tuya refuses
  the discovery call the Hub logs why and lists `TUYA_DEVICE_IDS` only, exactly as
  before. Confirm it against your own project with the check under "Device discovery".
- `GET /:id/status` / `POST /:id/commands` do not check the device id
  against `TUYA_DEVICE_IDS` before calling the adapter — any native id the
  Tuya account can see will be forwarded. This was a deliberate choice this
  sprint: gating on a locally cached device list would only be safe if that
  cache were always freshly populated, and requiring an extra list call
  before every status/command call would change the call pattern of the
  already-verified baseline flow. `DEVICE_NOT_FOUND` is therefore reactive
  (based on Tuya's own response), not proactive.
- Capability `type` / `values` are in the protocol's own vocabulary (Tuya's
  `Boolean`/`Integer`/`Enum`/…). The structure is protocol-neutral; the type
  names are not mapped to a hub-defined vocabulary yet.
- `POST .../commands` does **not** validate `{code, value}` against the
  device's capabilities. It never did; capabilities are advisory information
  for clients, not enforcement. A wrong code/value reaches Tuya and comes back
  as an upstream error.
- Capabilities are fetched live on every request — no caching (no persistence
  layer exists), so each call costs one to two Tuya API calls.
- The status/commands routes interpolate the native id into the Tuya request
  path without URL-encoding it (frozen baseline code, deliberately not changed
  this sprint). Because Express decodes `%2F` in `:id`, a crafted id can alter
  the path of an authenticated Tuya request. The new `getDeviceCapabilities`
  does URL-encode it. Combined with there being no auth on the hub (below),
  don't expose the hub beyond a trusted network. Fixing the frozen methods is
  a candidate for a future sprint.
- Only the Tuya adapter exists. Matter/Zigbee/MQTT/IR/RF are structural
  placeholders (see `src/bootstrap.js` comments) — no code for them yet, as
  requested.
- No web frontend (the Flutter app in `mobile/` is the only client), no
  persistence/database, no auth, no push/real-time updates — out of scope for
  this step. Clients must poll `/status`.

## Setup

```bash
npm install
cp .env.example .env   # then fill in your real TUYA_ACCESS_ID / TUYA_ACCESS_SECRET
```

`.env` is git-ignored. Credentials are never hard-coded — `TuyaAdapter`
throws immediately if `TUYA_ACCESS_ID` / `TUYA_ACCESS_SECRET` are missing.

Requires **Node.js >= 20.7**. `npm start` loads `.env` using Node's built-in
`--env-file` flag (there is no `dotenv` dependency), which is why a recent Node
is needed: `--env-file` does not exist before 20.6, and on 20.6.x it lets the
file override real environment variables, which changed in 20.7.

## Running

```bash
npm run lint        # ESLint (eslint:recommended)
npm test            # unit + API tests — no network, no real credentials needed
npm run test:unit   # TuyaAdapter offline unit tests only
npm run test:api    # Express route tests only (FakeTuyaAdapter)
npm start           # node --env-file=.env src/server.js — loads .env, then starts the real server
                    # on PORT (default 3000); needs real Tuya credentials in .env
```

How `npm start` handles `.env`:

- `PORT`, `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_ENDPOINT` and
  `TUYA_DEVICE_IDS` are read from `.env` in the project root automatically.
  Previously `.env` was **not** loaded by `npm start`, so `PORT` and
  `TUYA_DEVICE_IDS` in it were silently ignored; they now take effect.
- If `.env` does not exist, Node refuses to start (`.env: not found`) rather
  than running half-configured — create it from `.env.example` first. To run
  with real environment variables only (e.g. a container with no `.env` file),
  start the entry point directly: `node src/server.js`.
- A variable that is already set in the shell/process environment **wins** over
  the same key in `.env`. A stale `TUYA_ACCESS_SECRET` exported in your shell
  will therefore silently shadow `.env`; `node scripts/check-env.js` reports
  a shell-vs-file mismatch.

All automated tests use an injected fake HTTP transport / a `FakeTuyaAdapter`
— they never call the real Tuya API and never toggle the real device. This
project does not touch, and did not need to touch, the Tuya Developer
Platform or `tuya-package` in any way.

## Verified results (capabilities + startup sprints)

- `npm install` → OK (no new dependencies — only Node built-ins and the
  existing `express`/`eslint`).
- `npm run lint` → **PASS** (0 errors/warnings).
- `npm run test:unit` → **PASS** — 87/87 assertions across 7 files:
  - `tuyaAdapter.test.js` (unchanged, regression check on the frozen baseline) — 11/11
  - `adapterRegistry.test.js` (unchanged) — 14/14
  - `normalizeTuyaErrors.test.js` (unchanged) — 11/11
  - `deviceService.test.js` (unchanged) — 13/13
  - `tuyaCapabilities.test.js` (new) — 21/21
  - `deviceServiceCapabilities.test.js` (new) — 8/8
  - `startupEnv.test.js` (new, `npm start` env loading) — 9/9
- `npm run test:api` → **PASS** — 34/34 assertions across 2 files:
  - `devices.routes.test.js` (unchanged) — 17/17
  - `capabilities.routes.test.js` (new) — 17/17
- `npm test` (both) → **PASS** — 121/121 total (the 112 from before unchanged and
  still passing, plus 9 new for startup env loading).
- Verified against the **real** Tuya cloud (outside the development sandbox):
  `GET /api/devices/tuya:1638018234ab950e1ecd/capabilities` returned the real
  device's (W-W603 2) actual capabilities.
- Not verified in the sandbox: `npm start` with real credentials — no
  `TUYA_ACCESS_ID`/`TUYA_ACCESS_SECRET` exist there, by design (the startup
  tests use dummy credentials only). Run it in your own environment once `.env`
  is filled in.
