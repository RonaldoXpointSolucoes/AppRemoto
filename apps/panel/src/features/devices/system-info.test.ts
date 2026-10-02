import { describe, expect, it } from 'vitest';
import { parseSystemInfo } from './system-info';

describe('parseSystemInfo', () => {
  it('correctly maps raw Windows 10.0.22631 to Windows 11 (23H2)', () => {
    const res = parseSystemInfo('Windows', '10.0.22631');
    expect(res.osName).toBe('Windows 11 (23H2)');
    expect(res.badge).toBe('Win 11');
    expect(res.versionLabel).toBe('Build 22631');
    expect(res.summary).toContain('Windows 11 (23H2)');
  });

  it('correctly maps Windows 10.0.19045 to Windows 10 (22H2)', () => {
    const res = parseSystemInfo('Windows', '10.0.19045');
    expect(res.osName).toBe('Windows 10 (22H2)');
    expect(res.badge).toBe('Win 10');
    expect(res.versionLabel).toBe('Build 19045');
  });

  it('correctly maps Windows 10.0.26200 to Windows 11 (24H2)', () => {
    const res = parseSystemInfo('Windows', '10.0.26200');
    expect(res.osName).toBe('Windows 11 (24H2)');
    expect(res.badge).toBe('Win 11');
  });

  it('extracts local IP address and handles detailed OS string', () => {
    const res = parseSystemInfo('Windows 11 Home Single Language', '25H2 (Build 26200.9457) · IP 192.168.15.12');
    expect(res.osName).toBe('Windows 11 Home Single Language');
    expect(res.badge).toBe('Win 11');
    expect(res.ip).toBe('192.168.15.12');
    expect(res.versionLabel).toBe('25H2 (Build 26200.9457)');
    expect(res.summary).toBe('Windows 11 Home Single Language · 25H2 (Build 26200.9457) · IP: 192.168.15.12');
  });

  it('fixes legacy Microsoft registry where Windows 11 has ProductName "Windows 10 Pro"', () => {
    const res = parseSystemInfo('Windows 10 Pro', '23H2 (Build 22631) · IP 10.0.0.5');
    expect(res.osName).toBe('Windows 11 Pro');
    expect(res.badge).toBe('Win 11');
    expect(res.ip).toBe('10.0.0.5');
  });

  it('identifies Windows Server', () => {
    const res = parseSystemInfo('Windows Server 2022 Standard', '10.0.20348');
    expect(res.badge).toBe('Server');
    expect(res.osName).toBe('Windows Server 2022 Standard');
  });
});
