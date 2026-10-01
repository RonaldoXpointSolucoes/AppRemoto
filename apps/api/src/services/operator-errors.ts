export class OperatorSetupDenied extends Error {}
export class DeviceToolError extends Error {
  readonly code: 'ACCESS_DENIED' | 'DEVICE_OFFLINE' | 'HEARTBEAT_UNCONFIRMED' |
    'INVALID_RUSTDESK_ID' | 'CREDENTIAL_UNAVAILABLE' | 'CONNECT_UNAVAILABLE' | 'DEVICE_BUSY';
  readonly statusCode: 403 | 409 | 503;
  constructor(code: DeviceToolError['code'], statusCode: DeviceToolError['statusCode'] = 503) {
    super(code); this.code = code; this.statusCode = statusCode;
  }
}
