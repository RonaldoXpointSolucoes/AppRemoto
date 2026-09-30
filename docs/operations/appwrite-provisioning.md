# Appwrite provisioning

This runbook provisions the Remote Platform foundation using the repository CLI. It is limited to endpoint `https://appwrite.xpointsolucoes.com.br/v1`, API project ID `6abc5640003cb361b809`, and database `remote_management`.

The console route prefix `project-default-` is not part of the API project ID. The exact-target guard rejects `default-6abc5640003cb361b809` and unrelated project IDs before writes.

## Prerequisites and credentials

- Use Node.js 24, the pnpm version declared in `package.json`, and Windows with a usable CurrentUser DPAPI profile.
- Install workspace dependencies from the committed lockfile.
- Use the dedicated key for this Appwrite project. Its configured scope is **all scopes**, by explicit user decision. Do not reuse credentials from other projects or put this key in browser/client application configuration.
- Keep the API key only as DPAPI CurrentUser ciphertext at `.local/remote-platform/appwrite-api-key.dpapi` in the main checkout. A linked worktree may reference that protected file by its absolute path.
- Keep responses, reports, bootstrap artifacts, and diagnostics under `.local/remote-platform/`, which is Git-ignored. Never commit that directory or `.superpowers` execution reports.
- Obtain authorization for production apply, including administrator reconciliation, at action time. Inspect and plan are read-only.

The key must not appear in argv, terminal output, transcripts, logs, or plaintext files. Decrypt inside the same PowerShell process that invokes the CLI, supply only `APPWRITE_API_KEY` to the child environment, and clear the environment and byte buffers in `finally`. The following pattern assumes `$credentialPath` points to the existing protected file and runs from the repository root:

```powershell
$ErrorActionPreference = 'Stop'
$clear = $null
$protected = $null
try {
    Add-Type -AssemblyName System.Security
    $protected = [IO.File]::ReadAllBytes($credentialPath)
    $clear = [Security.Cryptography.ProtectedData]::Unprotect(
        $protected, $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $env:APPWRITE_API_KEY = [Text.Encoding]::UTF8.GetString($clear)
    $env:APPWRITE_ENDPOINT = 'https://appwrite.xpointsolucoes.com.br/v1'
    $env:APPWRITE_PROJECT_ID = '6abc5640003cb361b809'
    pnpm --filter @appremoto/appwrite provision inspect
    if ($LASTEXITCODE -ne 0) { throw 'Inspect failed' }
} finally {
    $env:APPWRITE_API_KEY = $null
    $env:APPWRITE_ENDPOINT = $null
    $env:APPWRITE_PROJECT_ID = $null
    if ($clear) { [Array]::Clear($clear, 0, $clear.Length) }
    if ($protected) { [Array]::Clear($protected, 0, $protected.Length) }
    $clear = $null
    $protected = $null
}
```

Do not print the environment. Managed strings cannot be guaranteed overwritten byte-for-byte; keep their lifetime short and terminate the process after use. DPAPI ciphertext is tied to the Windows user/profile. Do not substitute `LocalMachine` or plaintext when a different user cannot decrypt it.

## Inspect, plan, and apply

With the environment supplied as above, the supported commands are:

```powershell
pnpm --filter @appremoto/appwrite provision inspect
pnpm --filter @appremoto/appwrite provision plan
# Only after production authorization and review of a conflict-free plan:
pnpm --filter @appremoto/appwrite provision apply
pnpm --filter @appremoto/appwrite provision inspect
pnpm --filter @appremoto/appwrite provision plan
```

The package script calls `node --experimental-strip-types src/cli.ts` from `infra/appwrite`. It accepts one mode argument; it does not accept keys in argv or a saved plan-file argument. Save captured CLI JSON only after checking exit code, redaction, target, and resource identities. Keep pre-apply and post-apply snapshots separate so subsequent checks do not erase the initial evidence.

Inspect reports only the declared database and collections; it is not a dump of documents, users, or every unrelated project resource. Plan reports resource identifiers and create/unchanged/conflict outcomes. A fresh empty project should yield:

| Resource | Create |
| --- | ---: |
| Database | 1 |
| Collections | 10 |
| Attributes | 65 |
| Indexes | 27 |
| Total | 103 |

Check every action against `infra/appwrite/src/schema.ts`. Stop for any conflict, unknown resource, credential exposure, target mismatch, or failed command. Do not infer zero conflicts from a failed or missing plan.

Apply re-inspects and builds a fresh plan before writing. It creates missing resources in dependency order, waits for attribute/index readiness, then bootstraps the administrator. It does not delete/recreate schema resources or reconcile incompatible schema definitions destructively. A successful post-apply plan for the current desired schema must show **103 unchanged, 0 create, 0 conflict**. Apply's own reported plan describes the actions selected before creation, not the post-apply inventory.

Against the 102-resource inventory already containing `enrollment_receipts.expected_use_count`, the current desired schema should plan **102 unchanged, 1 create, 0 conflict**. The sole create is the required boolean `enrollment_receipts/recovery_frozen`. Against the 101-resource inventory with the original six receipt attributes, plan **101 unchanged, 2 create, 0 conflict** for that boolean and the required integer `expected_use_count`. These are local expected deltas; use fresh inspect/plan and independent review before any authorized production apply. The verified 90-resource foundation below predates the collection: it would plan **90 unchanged, 13 create, 0 conflict** (one collection, eight attributes, four indexes).

Apply also saves a redacted `.local/remote-platform/apply-<uuid>.json`. Never treat the existence of that file as success; check its status and repeat inspect/plan.

Appwrite 1.7 may return zero index prefix lengths for omitted defaults. The comparator treats `0`, `null`, and omitted entries as the same default while requiring a present lengths array to have one entry per indexed attribute. Positive prefix lengths compare positionally; wrong cardinality, order, type, uniqueness, or indexed attributes still produce conflicts. Do not rebuild compatible indexes because of their default-value representation.

## Administrator and encrypted bootstrap artifact

The exact bootstrap email is `remote.admin@xpointsolucoes.com.br`. For a new identity, the bootstrap generates a random 32-character password containing uppercase, lowercase, digits, and symbols, protects it with DPAPI before creating the user, and uses ID `remote-bootstrap-admin`.

The protected artifact is `.local/remote-platform/bootstrap-<uuid>.dpapi`; the returned `encryptedArtifactPath` is authoritative. It contains raw DPAPI ciphertext, not JSON or base64. Check existence and decryptability only under CurrentUser, without printing plaintext. Validate the length and character classes in memory, then clear buffers. Keep this artifact available to the authorized operator; do not attach it to issues or commit it.

An existing identity is reused without a password reset or a newly generated artifact. The CLI ensures a unique `technician_profiles` document for that user, sets `global_role=super_admin`, and activates it. An existing inactive/wrong-role profile is repaired; duplicate identities/profiles cause failure. The report's `profile: reused` can include that role/active repair and does not mean a write-free bootstrap.

Verify by read-only queries that the exact email matches one user and that exactly one profile has the same `user_id`, `active=true`, and `global_role=super_admin`. Project only safe identifiers and these booleans/role into evidence; SDK user responses may contain credential-related fields and must not be persisted wholesale.

Protect-first ordering preserves the generated password if execution is interrupted after user creation. A retry that reuses the user will not return a new artifact path; retain the original local artifact and correlate it with the initial attempt. An artifact left before a failed user creation is not proof that an account exists or that its password is current.

## Recovery and non-destructive rollback

For a transient interruption, stop and rerun inspect/plan. If the result is conflict-free, the same apply command resumes only missing creates and waits for existing in-flight resources. Do not delete successful resources, indexes, users, or artifacts to make a retry look like a fresh installation. Stop on conflicts or an attribute/index failure and diagnose it before retrying.

There is no automatic destructive rollback. Preserve partial progress and reports. Pause further writes and prevent application use of an incomplete foundation. Reverting local code does not reverse Appwrite state. Schema migration, removal, administrator disablement, and other compensating production changes require their own reviewed scope; this runbook does not authorize them.

If apply fails while saving its local report, inspect production before retrying because remote writes may already have succeeded. Never weaken permissions or bypass the exact-project guard to work around a failure.

## API-key rotation and revocation

Create the replacement key in the same confirmed project with the approved scope configuration (currently all scopes). Capture its value through a private local flow and protect it with DPAPI CurrentUser immediately; never paste it into chat or a repository. Write new ciphertext to a separate local file first, preserving the old encrypted key until the replacement has been validated.

Use the new key in the same in-memory environment pattern to run inspect/plan and compare the target and expected outcomes. After explicit authorization and successful verification, switch local consumers to the new encrypted artifact and revoke the old key in the Appwrite console. Confirm the replacement still works and the retired key is rejected, recording only status/code. Do not persist either plaintext key during this check. If exposure is suspected, stop use and follow the authorized incident rotation/revocation process; redact any affected reports before sharing them.

Reducing scopes is a separate deliberate configuration change. A successful inspect alone does not prove that the replacement key can perform every apply/bootstrap operation.

## Local validation

```powershell
pnpm --filter @appremoto/appwrite test
pnpm test
pnpm typecheck
git diff --check
```

The Appwrite tests use fake gateways and synthetic secrets. The Windows DPAPI test needs the real CurrentUser profile and permission to create/remove a local encrypted test artifact. A sandbox-only DPAPI failure should be reproduced with the appropriate local profile access; do not change credential protection to make the test pass.

## Verified foundation snapshot

On 2026-09-30, the authorized initial apply completed with 90 resource creates and created the bootstrap administrator/profile. After the project-ID correction (`aaccda1`) and index-default/cardinality fixes (`8316a3a`, `ff8668a`), a read-only check at `2026-09-30T12:26:08Z` verified 1 database, 9 collections, 57 attributes, 23 indexes, and a plan of 90 unchanged / 0 create / 0 conflict / 0 unrelated resources. No second apply was needed for index normalization.

The exact administrator identity and its unique active `super_admin` profile were verified by SDK reads. The generated local DPAPI artifact passed CurrentUser decryption and in-memory format checks without revealing plaintext. Tests at `ff8668a` passed: Appwrite 47/47, workspace 56/56, and typecheck. This is dated evidence; rerun inspect/plan before future production changes. Machine-specific artifact paths and secret material remain local-only.
