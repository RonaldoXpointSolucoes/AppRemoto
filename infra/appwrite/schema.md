# Remote Management Appwrite Schema

Generated from `src/schema.ts`. Run `pnpm --filter @appremoto/appwrite schema:write` to regenerate.

- Database ID: `remote_management`
- Database name: `remote_management`

Collection order, attribute order, and index order are deterministic. Every collection has
empty collection permissions and document security disabled (server-only access).

## `organizations`

- Name: `organizations`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `name` | string | 128 | yes | - |
| `slug` | string | 64 | yes | - |
| `active` | boolean | - | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_slug` | unique | `slug` |

## `technician_profiles`

- Name: `technician_profiles`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `user_id` | string | 36 | yes | - |
| `display_name` | string | 128 | yes | - |
| `global_role` | enum | - | no | `super_admin` |
| `active` | boolean | - | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_user_id` | unique | `user_id` |

## `organization_members`

- Name: `organization_members`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `organization_id` | string | 36 | yes | - |
| `user_id` | string | 36 | yes | - |
| `role` | string | 64 | yes | - |
| `can_view` | boolean | - | yes | - |
| `can_connect` | boolean | - | yes | - |
| `can_manage_devices` | boolean | - | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_organization_id_user_id` | unique | `organization_id`, `user_id` |
| `q_organization_id` | key | `organization_id` |
| `q_user_id` | key | `user_id` |

## `devices`

- Name: `devices`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `organization_id` | string | 36 | yes | - |
| `device_uuid` | string | 36 | yes | - |
| `display_name` | string | 128 | yes | - |
| `hostname` | string | 255 | yes | - |
| `rustdesk_id` | string | 64 | yes | - |
| `operating_system` | string | 64 | yes | - |
| `os_version` | string | 128 | yes | - |
| `agent_version` | string | 64 | no | - |
| `rustdesk_version` | string | 64 | no | - |
| `last_seen_at` | datetime | - | no | - |
| `last_ip` | string | 45 | no | - |
| `enabled` | boolean | - | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_organization_id_device_uuid` | unique | `organization_id`, `device_uuid` |
| `q_organization_id` | key | `organization_id` |
| `q_last_seen_at` | key | `last_seen_at` |
| `q_display_name` | key | `display_name` |
| `q_hostname` | key | `hostname` |
| `q_rustdesk_id` | key | `rustdesk_id` |

## `device_tokens`

- Name: `device_tokens`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `device_id` | string | 36 | yes | - |
| `token_hash` | string | 64 | yes | - |
| `last_used_at` | datetime | - | no | - |
| `revoked_at` | datetime | - | no | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_token_hash` | unique | `token_hash` |
| `q_device_id` | key | `device_id` |

## `device_credentials`

- Name: `device_credentials`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `device_id` | string | 36 | yes | - |
| `password_ciphertext` | string | 4096 | yes | - |
| `password_nonce` | string | 128 | yes | - |
| `password_tag` | string | 128 | yes | - |
| `key_version` | integer | - | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_device_id` | unique | `device_id` |

## `enrollment_tokens`

- Name: `enrollment_tokens`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `organization_id` | string | 36 | yes | - |
| `token_hash` | string | 64 | yes | - |
| `expires_at` | datetime | - | yes | - |
| `max_uses` | integer | - | yes | - |
| `use_count` | integer | - | yes | - |
| `active` | boolean | - | yes | - |
| `created_by_user_id` | string | 36 | yes | - |
| `revoked_at` | datetime | - | no | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_token_hash` | unique | `token_hash` |
| `q_organization_id` | key | `organization_id` |

## `enrollment_receipts`

- Name: `enrollment_receipts`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `organization_id` | string | 36 | yes | - |
| `enrollment_token_id` | string | 36 | yes | - |
| `device_id` | string | 36 | yes | - |
| `device_uuid` | string | 36 | yes | - |
| `status` | enum | - | yes | `pending`, `committed` |
| `token_use_consumed` | boolean | - | yes | - |
| `expected_use_count` | integer | - | yes | - |
| `recovery_frozen` | boolean | - | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_enrollment_token_id_device_uuid` | unique | `enrollment_token_id`, `device_uuid` |
| `q_organization_id` | key | `organization_id` |
| `q_device_id` | key | `device_id` |
| `q_status` | key | `status` |

## `connection_sessions`

- Name: `connection_sessions`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `organization_id` | string | 36 | yes | - |
| `device_id` | string | 36 | yes | - |
| `technician_user_id` | string | 36 | yes | - |
| `connect_token_hash` | string | 64 | yes | - |
| `expires_at` | datetime | - | yes | - |
| `redeemed_at` | datetime | - | no | - |
| `status` | enum | - | yes | `pending`, `redeemed`, `expired`, `failed` |
| `source_ip` | string | 45 | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `u_connect_token_hash` | unique | `connect_token_hash` |
| `q_organization_id` | key | `organization_id` |
| `q_device_id` | key | `device_id` |
| `q_technician_user_id` | key | `technician_user_id` |

## `audit_logs`

- Name: `audit_logs`
- Permissions: `[]`
- Document security: `false`

| Attribute | Type | Size | Required | Enum elements |
| --- | --- | ---: | :---: | --- |
| `organization_id` | string | 36 | yes | - |
| `actor_type` | enum | - | yes | `technician`, `device`, `system` |
| `actor_id` | string | 36 | yes | - |
| `device_id` | string | 36 | no | - |
| `action` | string | 64 | yes | - |
| `result` | enum | - | yes | `success`, `failure` |
| `source_ip` | string | 45 | yes | - |
| `metadata_json` | string | 16384 | yes | - |

| Index ID | Type | Attributes |
| --- | --- | --- |
| `q_organization_id` | key | `organization_id` |
| `q_device_id` | key | `device_id` |
| `q_action` | key | `action` |
