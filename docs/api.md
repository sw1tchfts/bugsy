# Bugsy API, v1

The API lets the tools a pest control company already uses (an AI receptionist, the website's booking form, a lead
marketplace, smart traps) read and write that company's Bugsy data without custom work. Spec:
`specs/20-integrations-and-api.md`.

## Keys and scopes

The owner creates a key under Settings, Integrations, with only the scopes the tool needs. The key looks like
`bgy_<8 characters>_<secret>`; Bugsy stores only its SHA-256 hash and shows the whole key once. Revoking a key makes
every later call with it fail at once. A key belongs to one company and never acts as a person: what it writes (leads,
service requests, device checks) records the key that wrote it.

| Scope | Allows |
| --- | --- |
| `accounts.read` | `GET /api/v1/accounts/lookup` |
| `leads.write` | `POST /api/v1/leads` |
| `requests.write` | `POST /api/v1/service-requests` |
| `availability.read` | `GET /api/v1/availability` |
| `visits.read` | `GET /api/v1/visits` |
| `invoices.read` | `GET /api/v1/invoices` |
| `devices.write` | `POST /api/v1/device-events` |

Send the key as a bearer token (or in `x-api-key`):

```
Authorization: Bearer bgy_ab12cd34_...
```

## Answers and errors

Answers are JSON. Writes answer `201`, reads `200`. An error has a code and a message:

```json
{ "error": { "code": "forbidden", "message": "this key does not have the visits.read scope" } }
```

| Status | Code | When |
| --- | --- | --- |
| 401 | `unauthorized` | No key, a malformed key, a revoked key, or a suspended company |
| 403 | `forbidden` | The key lacks the scope |
| 404 | `not_found` | The property, device or account is not the key's company's |
| 422 | `invalid` | A field is missing or malformed |
| 429 | `rate_limited` | Over 60 calls in a minute for the key (shared by every tool using it; refused calls do not count); wait `Retry-After` seconds |
| 500 | `server_error` | Try again |

Every call is logged (method, path, status and time, never the body) for 30 days; the owner sees the latest calls and
each key's last use.

## Endpoints

### `GET /api/v1/accounts/lookup?phone=...&email=...`

Who a caller is. Matches accounts by their own or a contact's phone (last 10 digits) or email, and open leads.

```json
{
  "accounts": [{ "account_id": "...", "name": "Jane Smith", "status": "active",
                 "properties": [{ "property_id": "...", "address": "12 ELM ST, COLUMBUS OH 43215" }] }],
  "leads": [{ "lead_id": "...", "name": "Sam Lee", "stage": "new" }]
}
```

### `POST /api/v1/leads`

```json
{ "name": "Sam Lee", "phone": "614-555-0100", "email": "sam@example.com", "source": "HomeAdvisor",
  "line1": "12 Elm St", "city": "Columbus", "state_code": "OH", "postal_code": "43215", "notes": "Ants in the kitchen" }
```

A name and a phone or email are required. `source` becomes one of the company's lead sources (default `API`). The lead is
always created; anything it may duplicate (an account, a contact's account or an open lead with the same email or phone)
comes back for the office to merge:

```json
{ "lead_id": "...", "source": "HomeAdvisor", "possible_matches": [{ "kind": "account", "id": "...", "name": "Sam Lee" }] }
```

### `POST /api/v1/service-requests`

```json
{ "property_id": "...", "kind": "booking", "preferred_date": "2026-11-12", "service_type_id": "...", "details": "Wasps by the garage" }
```

`kind` is `booking` (which names one of the company's service types) or `reservice` (tied to the property's active
plan). The request lands in the
office's requests inbox to confirm; nothing is scheduled by the API. Answers `{ "request_id": "...", "status": "open" }`.

### `GET /api/v1/availability?property_id=...`

The days in the next 14 where a technician of the property's branch has fewer stops than the company's daily limit:
weekdays, and a weekend day where the company has worked that day of the week in the last 90 days. It promises nothing
and books nothing:

```json
{ "days": [{ "date": "2026-11-04", "windows": ["morning", "afternoon"] }] }
```

### `GET /api/v1/visits?account_id=...&from=YYYY-MM-DD&to=YYYY-MM-DD`

An account's visits in a span of up to a year: id, property, service type, status, kind, due window, scheduled day,
arrival window and completion time. No pesticide application details.

### `GET /api/v1/invoices?account_id=...`

An account's issued invoices: id, number, status, issued and due days, `total_cents` and `paid_cents`. Money is in
integer cents.

### `POST /api/v1/device-events`

A smart trap's catch or alert. The device is named by its barcode on the company's sites; it becomes a check in the
device's history with source `sensor`.

```json
{ "barcode": "NW-RS-0001", "count": 2, "pest": "House mouse", "at": "2026-11-01T14:03:00Z", "note": "Door 3 trap" }
```

An unknown barcode answers 404. Answers `{ "check_id": "..." }`.

## Webhooks

A subscription (Settings, Integrations) sends the events it names to an `https://` URL on a public host (addresses
inside private networks are refused):

| Event | Data |
| --- | --- |
| `lead.created` | lead_id, name, email, phone, source, created_at |
| `service_request.created` | request_id, account_id, property_id, kind, preferred_date, created_at |
| `visit.scheduled` | visit_id, account_id, property_id, scheduled_for, arrival_window, technician |
| `visit.completed` | visit_id, account_id, property_id, completed_at, service_type |
| `invoice.paid` | invoice_id, account_id, number, total_cents, paid_at |

Payloads never carry card data, pesticide application details, or anything the subscribed events do not name:

```json
{ "event": "lead.created", "id": "<delivery id>", "created_at": "2026-11-01T14:03:00Z", "data": { "lead_id": "...", "source": "Website" } }
```

Each delivery is a `POST` with the header `bugsy-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, keyed
with the subscription's secret (shown once when it is created). Check it before trusting the body, and refuse
timestamps more than five minutes old:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(secret, body, header) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
  return Math.abs(Date.now() / 1000 - Number(parts.t)) <= 300 && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? ""));
}
```

Deliveries go out after each messaging job, in order per subscription (a delivery waits while an earlier one is being
retried), at least once (use the `id` to drop repeats). A
receiver answers any 2xx; anything else, or no answer in 10 seconds, is retried after 1 minute, 5 minutes, 30 minutes,
2 hours and 12 hours, then marked failed. A `410 Gone` turns the subscription off. The delivery log keeps 30 days.

## Phone system events

Connecting the phone system (Settings, Integrations) gives it an address,
`/api/integrations/phone/<connection key>`, and a secret. The phone system posts each call event there, signed the same
way as webhooks (`bugsy-signature`):

```json
{ "call_id": "provider-call-id", "direction": "inbound", "from": "+16145550100", "to": "+16145550199",
  "started_at": "2026-11-01T14:03:00Z", "duration_seconds": 184, "recording_url": "https://..." }
```

The caller is matched by number to a contact, an account or a lead (newest first) and the call is logged on it once by
its `call_id`; a later event with the same id adds the length and recording. While an inbound call has no length yet
(it is ringing), the office screens show who is calling.

## QuickBooks Online

Not part of the API: the bookkeeper connects QuickBooks under Settings, Integrations (OAuth with Intuit when
`QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are set, a local test company otherwise), maps Bugsy's accounts to theirs, and
after each billing job sends each closed day's journal once, as one entry summed per account. A day holds what was
posted for it (an entry dated into a day already sent goes with the day it was entered), the sync resumes from the
first unsent day, and a day with an unmapped account waits and says which.
