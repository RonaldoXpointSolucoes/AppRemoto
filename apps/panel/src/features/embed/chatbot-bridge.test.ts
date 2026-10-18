import { describe, expect, it } from 'vitest';
import type { DeviceView } from '@appremoto/contracts';
import {
  buildPreservedRoute,
  deviceMatchesCnpjContext,
  formatDocumentDisplay,
  normalizeDocumentDigits,
  parseChatbotInboundMessage,
  parseInitialChatbotContext,
} from './chatbot-bridge';

function createDevice(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 'device-1',
    organizationId: 'org-1',
    organizationName: 'Supermercado Matriz',
    deviceUuid: '550e8400-e29b-41d4-a716-446655440000',
    displayName: 'SUPERMERCADO - CAIXA-01',
    hostname: 'CAIXA-01',
    operatingSystem: 'Windows 11 Pro',
    osVersion: '10.0.22631',
    rustdeskId: '987654321',
    agentVersion: '1.3.1',
    rustdeskVersion: '1.4.0',
    status: 'ONLINE',
    lastSeenAt: '2026-10-18T12:00:00.000Z',
    enabled: true,
    datadivas: {
      cnpj: '12.345.678/0001-90',
      nomeFantasia: 'Supermercado Matriz',
      razaoSocial: 'Supermercado Matriz LTDA',
      funcao: 'CAIXA',
    },
    ...overrides,
  };
}

describe('chatbot-bridge', () => {
  it('normalizes and formats 14-digit CNPJs accurately', () => {
    expect(normalizeDocumentDigits('12.345.678/0001-90')).toBe('12345678000190');
    expect(formatDocumentDisplay('12345678000190')).toBe('12.345.678/0001-90');
  });

  it('parses initial Chatbot context from URL query string', () => {
    const parsed = parseInitialChatbotContext(
      '?embed=1&cnpj=12.345.678/0001-90&contactName=Joao%20Financeiro&contactPhone=5562999999999&conversationId=conv-42&role=CAIXA-01'
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.cnpj).toBe('12345678000190');
    expect(parsed?.formattedCnpj).toBe('12.345.678/0001-90');
    expect(parsed?.contactName).toBe('Joao Financeiro');
    expect(parsed?.contactPhone).toBe('5562999999999');
    expect(parsed?.conversationId).toBe('conv-42');
    expect(parsed?.preferredRole).toBe('CAIXA-01');
  });

  it('preserves safe Chatbot query parameters across /login and /devices navigation', () => {
    expect(buildPreservedRoute('/devices', '')).toBe('/devices');
    expect(
      buildPreservedRoute(
        '/login',
        '?embed=1&cnpj=12345678000190&contactName=Cliente&unsafeToken=secret'
      )
    ).toBe('/login?embed=1&cnpj=12345678000190&contactName=Cliente');
  });

  it('parses inbound postMessage events from the Chatbot host', () => {
    const setContextAction = parseChatbotInboundMessage({
      type: 'XPOINT_REMOTE_SET_CNPJ',
      cnpj: '12.345.678/0001-90',
      contactName: 'Padaria Central',
      contactId: 'contact-99',
      conversationId: 'chat-77',
      openCnpjModal: true,
    });

    expect(setContextAction).toEqual(
      expect.objectContaining({
        action: 'SET_CONTEXT',
        context: expect.objectContaining({
          cnpj: '12345678000190',
          formattedCnpj: '12.345.678/0001-90',
          contactName: 'Padaria Central',
          contactId: 'contact-99',
          conversationId: 'chat-77',
          openCnpjModal: true,
        }),
      })
    );

    expect(parseChatbotInboundMessage({ type: 'XPOINT_REMOTE_CLEAR_CNPJ' })).toEqual({
      action: 'CLEAR_CONTEXT',
    });

    expect(
      parseChatbotInboundMessage({
        type: 'XPOINT_REMOTE_OPEN_CNPJ_MODAL',
        cnpj: '12.345.678/0001-90',
      })
    ).toEqual({
      action: 'OPEN_CNPJ_MODAL',
      cnpj: '12345678000190',
    });
  });

  it('matches devices against normalized CNPJ digits even when stored with punctuation', () => {
    const dev = createDevice();
    expect(deviceMatchesCnpjContext(dev, '12345678000190')).toBe(true);
    expect(deviceMatchesCnpjContext(dev, '12.345.678/0001-90')).toBe(true);
    expect(deviceMatchesCnpjContext(dev, '99.999.999/0001-99')).toBe(false);
  });
});
