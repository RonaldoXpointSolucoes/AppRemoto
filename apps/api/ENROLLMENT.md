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
an independent source-IP admission limit before bounded per-source token-hash
buckets. One source can retain at most its admission limit of token entries and
cannot fill the other source slots by changing tokens. Rate state resets on restart.
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

Before any device/credential mutation, a pending receipt persists its
`expected_use_count` target. Consumption updates **only** use_count, setting that
target after credentials persist; it never rewrites a stale active flag.
Confirmed failures use reverse snapshot compensation; datetime fields compare
normalized instants so Appwrite UTC offset formatting does not cause conflicts.

Network failures and timeouts have indeterminate outcomes. Bounded polling can
confirm the exact new state, but a read of the old state never proves rollback.
If outcome remains unknown, keep all artifacts and the pending receipt, freeze
the enrollment token with active=false, return a generic error and audit recovery
required. An indeterminate compensation also stops destructive cleanup. Queries
for pending receipts block other devices even after process replacement.

Recovery of a pending consumption requires matching identities and artifacts,
token use_count exactly equal to expected_use_count, and durably observed
active=false. Counts below or above the target remain pending; do not replay a
write that may still be in flight. Recovery rotates credentials and commits the
receipt without another count increment. The token remains permanently inactive
for manual review, sacrificing remaining capacity so a late count-only write
cannot affect later enrollment uses or reactivate the token.

For indeterminate credential rotations, the same process must first observe the
unique hash/envelope it attempted to write before another rotation is safe.
After process-state loss, a pending consumed receipt does not prove which
credential generation will finish; it fails closed for manual reconciliation.
The journal is in memory. A distributed transaction or durable generation/fencing
design is required for automatic recovery of every crash/rotation phase.

Known token, device and receipt denials write a best-effort failure audit with
fixed nonsecret reason codes. Audit failure cannot mutate enrollment state or
change the stable denial response. Unknown tokens have no trusted organization;
they do not write organization audit rows and emit only a generic application log.
The global application logger omits raw URLs/queries and exception messages on
POST, OPTIONS, unsupported methods, not-found and error responses.
