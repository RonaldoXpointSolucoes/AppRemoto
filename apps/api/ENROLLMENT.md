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

## Existing device reconfiguration

`POST /v1/agent/reconfigure` adds `currentDeviceToken` to the enrollment request. Both a valid unexpired enrollment package and a matching enabled device's existing credential are required. Organization and UUID must match; display names are editable labels. It shares enrollment token/device queues and route admission limits. The response is only `{ deviceId, reconfigured: true }`, never a password/token.

Under the persistent heartbeat guard, write the new pending receipt, consume its use once, patch only display_name, audit, and commit its receipt. Known failures retain resumable state; retries with both proofs may finalize it. An indeterminate database mutation keeps the durable guard and freezes the package, requiring reconciliation before another writer. A committed retry acknowledges only an already matching name and active credentials/package, with no second write or secret replay. Old packages cannot rename back after a later rename. Panel status requires a heartbeat after the committed receipt's Appwrite timestamp. The initial enrollment one-time secret boundary is unchanged.

## Generic Windows installer

A super administrator can create, list, download again and revoke profiles at `/v1/generic-installers`, `/:installerId/package` and `/:installerId/revoke`. The private executable overlay carries a profile ID and a reusable enrollment-only capability. Only its hash is persisted; its value is derived using a separate HMAC domain and the server encryption key. It cannot list devices or retrieve existing device credentials. Anyone holding this private executable can register a computer and receive the shared password, so distribute it only to authorized technicians. Revocation blocks new preparation and enrollment; it cannot revoke passwords already delivered.

`POST /v1/agent/prepare-installation` authenticates the capability, not a panel session. Its strict body contains `installerId`, `requestId`, a random 32-byte base64url `requestSecret`, `companyName`, `deviceDisplayName`, and an optional `existingOrganizationId`. Persist this request under DPAPI before sending it. Identical proofs and normalized fields recover the same 30-minute, one-use enrollment package after retry or API restart. Changed fields or proof under the same request ID are rejected before creating an organization. An expired package requires a fresh request ID/proof; it cannot extend its original deadline.

Company names use NFKC, collapsed whitespace and case-insensitive matching. Reuse is permitted only for one active exact normalized match; ambiguous or inactive matches fail explicitly. New organization IDs are deterministic. Creation and preparation share bounded in-process queues, so deployment remains one API writer with stop-before-start rollout. The resulting provisioning document remains schema version 1 and adds `organizationName`; normal enrollment retains its existing replay and secret-delivery boundary.

`GENERIC_INSTALLER_SHARED_PASSWORD` is a server-only runtime secret, 16–128 characters and at most 128 UTF-8 bytes. It is never embedded in the executable, returned by preparation, written to logs or stored unencrypted. Fresh generic enrollment uses it; legacy packages retain their existing unique-password behavior. Profile revocation or issuer permission removal is rechecked before a new enrollment or reconfiguration acknowledges success. Changing this runtime secret does not rotate existing machines automatically.

## Existing machine shared-password rotation

After generic reconfiguration, `POST /v1/agent/generic-password` stages a rotation using the same request fields as reconfiguration, including the fresh generic enrollment proof and current device credential. It returns `{ deviceId, rustdeskPassword, rotationId }`. The agent persists its recovery request before staging and the received password under DPAPI before applying it to RustDesk. It then calls `/v1/agent/generic-password/confirm` with the same proofs after successful application; the API returns `{ deviceId, applied: true }`. No heartbeat is acknowledged and no new panel connection is authorized until this guard is released.

The durable heartbeat guard uses the enrollment receipt ID as `operation_id`. Acquire it before writing the immutable rotation start timestamp and target password hash. This allows recovery after a lost response or API restart without allowing a late initialization write to change guard ownership or demote progress. Confirmation writes the encrypted credential once, verifies the persisted password hash, records the audit event, marks completion and releases only its own guard. ACK loss is idempotent. A matching pending rotation can finish after package expiry or generic-profile revocation; it still requires the original proofs and enabled device credentials. New staging remains forbidden after expiry or revocation.

Never change the configured shared password while a rotation is pending. A changed policy is rejected without releasing its guard. A credential write with an unknown outcome is not blindly repeated. If the persisted target appears, the same proofs can finish confirmation; otherwise reconciliation is required. In particular, an API crash after persisting the credential-write intent but before submitting its PATCH intentionally remains blocked until reconciliation. Preserve the receipt, guard and client DPAPI recovery journal in this case. The initial enrollment one-time secret-delivery limitation also remains unchanged.

The generic installer schema adds `generic_installers`, optional enrollment origin/request binding, rotation receipt markers, and optional `heartbeat_guards.operation_id`. The canonical schema contains 123 resources (12 collections, 82 attributes and 28 indexes plus the database). Apply the additive schema before starting the new API; old enrollment and heartbeat records remain readable.
