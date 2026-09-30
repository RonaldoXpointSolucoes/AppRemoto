type AttributeBase = { readonly key: string; readonly required: boolean; readonly array?: boolean };

export type SchemaAttribute = AttributeBase & (
  | { readonly type: 'string'; readonly size: number; readonly default?: string | null; readonly encrypt?: boolean; readonly format?: string | null }
  | { readonly type: 'enum'; readonly elements: readonly string[]; readonly default?: string | null; readonly format?: string | null }
  | { readonly type: 'integer' | 'float'; readonly min?: number | null; readonly max?: number | null; readonly default?: number | null }
  | { readonly type: 'boolean'; readonly default?: boolean | null }
  | { readonly type: 'datetime'; readonly default?: string | null; readonly format?: string | null }
);

export type SchemaIndex = {
  readonly id: string;
  readonly type: 'unique' | 'key';
  readonly attributes: readonly string[];
  readonly lengths?: readonly number[];
};

export type SchemaCollection = {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly documentSecurity: boolean;
  readonly attributes: readonly SchemaAttribute[];
  readonly indexes: readonly SchemaIndex[];
};

export type RemoteManagementSchema = {
  readonly database: { readonly id: string; readonly name: string };
  readonly collections: readonly SchemaCollection[];
};

const string = (key: string, size: number, required = true) => ({ key, type: 'string' as const, size, required });
const enumeration = (key: string, elements: readonly string[], required = true) => ({ key, type: 'enum' as const, elements, required });
const integer = (key: string) => ({ key, type: 'integer' as const, required: true });
const boolean = (key: string) => ({ key, type: 'boolean' as const, required: true });
const datetime = (key: string, required = true) => ({ key, type: 'datetime' as const, required });

const unique = (...attributes: string[]): SchemaIndex => ({
  id: `u_${attributes.join('_')}`, type: 'unique', attributes,
});
const key = (attribute: string): SchemaIndex => ({ id: `q_${attribute}`, type: 'key', attributes: [attribute] });

function collection(id: string, attributes: readonly SchemaAttribute[], indexes: readonly SchemaIndex[]): SchemaCollection {
  return { id, name: id, permissions: [], documentSecurity: false, attributes, indexes };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const REMOTE_MANAGEMENT_SCHEMA: RemoteManagementSchema = deepFreeze({
  database: { id: 'remote_management', name: 'remote_management' },
  collections: [
    collection('organizations', [
      string('name', 128), string('slug', 64), boolean('active'),
    ], [unique('slug')]),
    collection('technician_profiles', [
      string('user_id', 36), string('display_name', 128),
      enumeration('global_role', ['super_admin'], false), boolean('active'),
    ], [unique('user_id')]),
    collection('organization_members', [
      string('organization_id', 36), string('user_id', 36), string('role', 64),
      boolean('can_view'), boolean('can_connect'), boolean('can_manage_devices'),
    ], [unique('organization_id', 'user_id'), key('organization_id'), key('user_id')]),
    collection('devices', [
      string('organization_id', 36), string('device_uuid', 36), string('display_name', 128),
      string('hostname', 255), string('rustdesk_id', 64), string('operating_system', 64),
      string('os_version', 128), string('agent_version', 64, false),
      string('rustdesk_version', 64, false), datetime('last_seen_at', false),
      string('last_ip', 45, false), boolean('enabled'),
    ], [
      unique('organization_id', 'device_uuid'), key('organization_id'), key('last_seen_at'),
      key('display_name'), key('hostname'), key('rustdesk_id'),
    ]),
    collection('device_tokens', [
      string('device_id', 36), string('token_hash', 64),
      datetime('last_used_at', false), datetime('revoked_at', false),
    ], [unique('token_hash'), key('device_id')]),
    collection('device_credentials', [
      string('device_id', 36), string('password_ciphertext', 4096),
      string('password_nonce', 128), string('password_tag', 128), integer('key_version'),
    ], [unique('device_id')]),
    collection('enrollment_tokens', [
      string('organization_id', 36), string('token_hash', 64), datetime('expires_at'),
      integer('max_uses'), integer('use_count'), boolean('active'), string('created_by_user_id', 36),
    ], [unique('token_hash'), key('organization_id')]),
    collection('enrollment_receipts', [
      string('organization_id', 36), string('enrollment_token_id', 36),
      string('device_id', 36), string('device_uuid', 36),
      enumeration('status', ['pending', 'committed']), boolean('token_use_consumed'),
    ], [
      unique('enrollment_token_id', 'device_uuid'), key('organization_id'),
      key('device_id'), key('status'),
    ]),
    collection('connection_sessions', [
      string('organization_id', 36), string('device_id', 36), string('technician_user_id', 36),
      string('connect_token_hash', 64), datetime('expires_at'), datetime('redeemed_at', false),
      enumeration('status', ['pending', 'redeemed', 'expired', 'failed']), string('source_ip', 45),
    ], [
      unique('connect_token_hash'), key('organization_id'), key('device_id'), key('technician_user_id'),
    ]),
    collection('audit_logs', [
      string('organization_id', 36), enumeration('actor_type', ['technician', 'device', 'system']),
      string('actor_id', 36), string('device_id', 36, false), string('action', 64),
      enumeration('result', ['success', 'failure']), string('source_ip', 45),
      string('metadata_json', 16384),
    ], [key('organization_id'), key('device_id'), key('action')]),
  ],
} satisfies RemoteManagementSchema);

export function renderSchemaMarkdown(schema: RemoteManagementSchema): string {
  const lines = [
    '# Remote Management Appwrite Schema',
    '',
    'Generated from `src/schema.ts`. Run `pnpm --filter @appremoto/appwrite schema:write` to regenerate.',
    '',
    `- Database ID: \`${schema.database.id}\``,
    `- Database name: \`${schema.database.name}\``,
    '',
    'Collection order, attribute order, and index order are deterministic. Every collection has',
    'empty collection permissions and document security disabled (server-only access).',
    '',
  ];

  for (const item of schema.collections) {
    lines.push(`## \`${item.id}\``, '',
      `- Name: \`${item.name}\``,
      `- Permissions: \`${JSON.stringify(item.permissions)}\``,
      `- Document security: \`${item.documentSecurity}\``, '',
      '| Attribute | Type | Size | Required | Enum elements |',
      '| --- | --- | ---: | :---: | --- |');
    for (const attribute of item.attributes) {
      lines.push(`| \`${attribute.key}\` | ${attribute.type} | ${'size' in attribute ? attribute.size : '-'} | ${attribute.required ? 'yes' : 'no'} | ${'elements' in attribute ? attribute.elements.map((element) => `\`${element}\``).join(', ') : '-'} |`);
    }
    lines.push('', '| Index ID | Type | Attributes |', '| --- | --- | --- |');
    for (const index of item.indexes) {
      lines.push(`| \`${index.id}\` | ${index.type} | ${index.attributes.map((attribute) => `\`${attribute}\``).join(', ')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
