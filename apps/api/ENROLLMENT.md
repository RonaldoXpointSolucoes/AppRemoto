# Enrollment operation

`POST /v1/agent/enroll` accepts the strict contracts package request. The enrollment
token is supplied only as `enrollmentToken` in the JSON body. Organization identity
comes exclusively from the stored token hash lookup. Responses contain one-time
plaintext credentials and must not be cached or logged. Persisted device tokens
are SHA-256 hashes; RustDesk passwords use the versioned AES-GCM envelope.

## Deployment constraint

Run exactly **one API replica with one Node process**, including during deployment.
Stop the old process before starting its replacement; overlapping rolling updates,
cluster mode, autoscaling, parallel jobs, and a second enrollment writer are unsupported.
Set `API_REPLICAS=1` and `WEB_CONCURRENCY=1`. Configuration refuses other values and
nonzero `NODE_APP_INSTANCE`. These checks reject declared scaling; they cannot
discover another container that incorrectly declares itself the sole replica.
The deployment operator must enforce the single-instance constraint. Appwrite
does not provide compare-and-swap here. A distributed lock/transaction design is
required before adding replicas or writers.

`TRUST_PROXY` defaults to `false`. To use a reverse proxy, supply its exact trusted
IP addresses/CIDRs separated by commas, never unrestricted trust. The source IP
comes from Fastify's configured trust chain, is canonicalized, and is used with
the token hash for bounded in-memory rate limits. Rate state resets on restart.
Do not configure a proxy to log enrollment request/response bodies or credentials.

`MASTER_ENCRYPTION_KEY_VERSION` defaults to 1 and accepts integers 1 through 65535.
The active encryption key must correspond to that version. A key rotation needs a
separate migration/read-key strategy for existing stored envelopes.

## Retry and failure recovery

Token-keyed serialization prevents lost increments and overuse. Identical concurrent
requests share one promise/response. A secondary device lock prevents different
enrollment tokens racing over the same organization/device identity. Document IDs
are deterministic hashes of nonsecret identity tuples.

A committed receipt binds token, organization, UUID and device ID. With an active,
unexpired token, enabled matching device and existing credentials, it allows a
retry to rotate credentials without consuming another use, including at max uses.
Existence of a device alone does not authorize this operation.

Only a pending receipt with matching identities, `token_use_consumed=false`, token
`use_count=0`, and no device/token/credential documents is reconciled automatically.
All other pending states fail closed and require operator reconciliation. Do not
delete a pending receipt or change a use count based on device existence alone.

Each mutation is journaled before submission and compensated in reverse order
against exact expected state. A post-write timeout is reconciled by rereading that
state. Credential persistence precedes token consumption; receipt commit and audit
follow. Late failure restores previous usable credentials and previous use count.
Compensation failures return a generic error, attempt the remaining undo operations,
write a best-effort fixed-field failure audit, and quarantine the token in memory.
An abrupt process loss loses the journal; pending/ambiguous state requires manual
reconciliation from trustworthy operational evidence. Inspect outstanding failures
before restarting or enabling enrollment after a storage outage. This saga is not
a distributed transaction and cannot guarantee atomic recovery during an ongoing
storage outage or process crash.
