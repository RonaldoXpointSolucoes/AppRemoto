# Enrollment operation

`POST /v1/agent/enroll` accepts the strict contracts package request. The enrollment
token is supplied only as `enrollmentToken` in the JSON body. Organization identity
comes exclusively from the stored token hash lookup. A response contains one-time
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
separate migration/read-key strategy for existing stored envelopes and derived
device tokens; replacing the key alone makes existing enrollment retries fail closed.
Receipts created by an older random-device-token implementation cannot reproduce
that token and fail closed; they require explicit migration/manual reconciliation.

## Retry and failure recovery

Token-keyed serialization prevents lost increments and overuse. Identical concurrent
requests share one promise/response. A secondary device lock prevents different
enrollment tokens racing over the same organization/device identity. Document IDs
are deterministic hashes of nonsecret identity tuples.

A committed receipt binds token, organization, UUID and device ID and is terminal:
a later POST is denied and never returns the device token or RustDesk password again.
Every HTTP call has its own queued operation: identical concurrent calls do not
share a Promise or response. Exactly one caller can commit and receive plaintext;
the queued callers observe the committed receipt and are denied. Device tokens are
canonical 43-character base64url HMAC-SHA256
values derived from the master key, the domain `appremoto:enrollment-device-token:v1`
with a NUL terminator, and the JSON tuple [organization ID, enrollment token ID,
device ID, device UUID, receipt ID]. Only the SHA-256 token hash is stored.
Only recovery of a still-pending indeterminate operation derives and constant-time
verifies that hash, rejects revoked device tokens, decrypts the authenticated password
envelope, commits the receipt and returns the response once. The random RustDesk
password is generated once during initial enrollment. Existence of a device alone
does not authorize enrollment or credential recovery.

Every new receipt starts with required `recovery_frozen=false`. Only the live
handler of an indeterminate write may set it true, after this operation changes an
active token to inactive and reads back that durable inactive state. The receipt
marker is then written and verified separately. Merely finding an inactive token,
including after restart, never establishes why it became inactive. A rejected
freeze cannot create this marker; a partial freeze without a verified marker
requires manual reconciliation. This provenance covers uncertain initial writes
and indeterminate compensation safety freezes; committed retries never rotate.

Administrative revocation MUST atomically PATCH `active=false` together with
`revoked_at=<server UTC timestamp>` on the enrollment token. Treat this timestamp
as irreversible; enrollment never writes or clears it. New/legacy unrevoked tokens
have null (or absent optional) revoked_at. Every authoritative enrollment-token
read checks revocation, including both freeze precondition reads, the actual
freeze PATCH response, immediately before/after the receipt marker, and replay
before returning credentials. Freeze sends only `{active:false}`. A concurrent
revocation therefore survives late count/freeze writes and always denies replay,
even if recovery_frozen had already been written or the process restarted.

Direct console changes of `active` alone are NOT a supported administrative
revocation protocol: Appwrite has no CAS and cannot distinguish an overlapping
active-only disable from our own freeze. Administrative tooling/operators must
write the independent timestamp, never clear it or re-enable that token. Create
a new token instead. This is a deployment gate, not an atomic transaction claim.
An operation already authorized before the final authoritative revocation read
cannot have its in-flight response recalled; revoke the bound device/device token
as well when existing device access must stop.

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

Recovery of a pending consumption requires matching identities and artifacts and
use_count exactly equal to expected_use_count. An inactive token additionally
requires recovery_frozen=true; administrator-disabled receipts without the marker
remain denied and audited. Counts below or above target remain pending; do not
replay a write that may still be in flight. Recovery verifies and returns the original
derived token and decrypted password, committing only the receipt without another
count increment and preserving the marker. No committed-to-pending transition is
submitted on retry, so no late retry PATCH can demote a finalized receipt.
The token remains permanently inactive for manual review, sacrificing remaining
capacity so a late count-only write cannot affect later uses or reactivate it.
After recovery commits the receipt, later requests are denied even after restart or
response loss. This preserves the one-time response boundary; operators must reconcile
a device whose recovery response was lost rather than re-expose its plaintext secrets.

For other indeterminate initial artifact writes, the same process must first
observe the exact attempted artifact. A pending consumed receipt without that
phase evidence fails closed after process-state loss. The journal is in memory;
a distributed transaction or durable fencing design is required for automatic
recovery of every ambiguous crash phase.

Known token, device and receipt denials write a best-effort failure audit with
fixed nonsecret reason codes. Audit failure cannot mutate enrollment state or
change the stable denial response. Unknown tokens have no trusted organization;
they do not write organization audit rows and emit only a generic application log.
The global application logger omits raw URLs/queries and exception messages on
POST, OPTIONS, unsupported methods, not-found and error responses.

Technician authentication failures follow the same trust boundary. Every 401, 403
and authentication-related 503 emits a structured application audit with action,
result and a fixed reason code. These events are marked `scope=unscoped` and contain
no user, credential or organization identifier. Authentication happens before an
organization is authorized, so the API does not invent an `organization_id`, query
memberships for a denied identity, or insert an invalid organization audit row.
