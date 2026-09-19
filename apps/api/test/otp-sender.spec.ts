import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { OtpSenderService } from '../src/modules/auth/services/otp-sender.service';
import { VonageSmsService } from '../src/modules/auth/services/vonage-sms.service';

/**
 * Delivery routing rules:
 * - Vonage configured -> always real send (any environment)
 * - not configured + production -> fail closed
 * - not configured + development -> log the code, set lastDevCode
 */
function createSender(options: {
  isProduction: boolean;
  vonageConfigured: boolean;
  vonageSend?: ReturnType<typeof vi.fn>;
}): OtpSenderService {
  const config = {
    getOrThrow: vi.fn((_key: string) => options.isProduction),
  } as unknown as ConfigService;
  const vonage = {
    configured: options.vonageConfigured,
    send: options.vonageSend ?? vi.fn(async () => true),
  } as unknown as VonageSmsService;
  return new OtpSenderService(config, vonage);
}

describe('OtpSenderService delivery routing', () => {
  it('uses Vonage when configured, even outside production', async () => {
    const vonageSend = vi.fn(async () => true);
    const sender = createSender({ isProduction: false, vonageConfigured: true, vonageSend });

    const result = await sender.send('+919876543210', '123456');

    expect(vonageSend).toHaveBeenCalledWith('+919876543210', '123456');
    expect(result.accepted).toBe(true);
    // The dev-response channel must stay empty on the real path.
    expect(sender.lastDevCode).toBeNull();
  });

  it('propagates Vonage rejections instead of pretending success', async () => {
    const vonageSend = vi.fn(async () => {
      throw new Error('Vonage rejected the SMS: invalid sender');
    });
    const sender = createSender({ isProduction: false, vonageConfigured: true, vonageSend });

    await expect(sender.send('+919876543210', '123456')).rejects.toThrow('invalid sender');
  });

  it('fails closed in production without a provider', async () => {
    const sender = createSender({ isProduction: true, vonageConfigured: false });

    await expect(sender.send('+919876543210', '123456')).rejects.toThrow('SMS provider is not configured');
    expect(sender.lastDevCode).toBeNull();
  });

  it('logs the code in development when no provider is configured', async () => {
    const sender = createSender({ isProduction: false, vonageConfigured: false });

    const result = await sender.send('+919876543210', '654321');

    expect(result.accepted).toBe(true);
    expect(sender.lastDevCode).toBe('654321');
  });
});

describe('VonageSmsService.send', () => {
  it('normalizes the E.164 phone and posts to Vonage with form encoding', async () => {
    const config = {
      get: vi.fn((key: string) => (key === 'sms.from' ? 'SAKYAFRM' : null)),
    } as unknown as ConfigService;
    const service = new VonageSmsService(config);
    // Inject credentials directly (constructor reads the same config keys).
    (service as unknown as { apiKey: string }).apiKey = 'key-1';
    (service as unknown as { apiSecret: string }).apiSecret = 'secret-1';

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ 'message-count': '1', messages: [{ status: '0', 'message-id': 'm-1' }] }), {
        status: 200,
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const accepted = await service.send('+919876543210', '123456');
      expect(accepted).toBe(true);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://rest.nexmo.com/sms/json');
      const body = String(init.body);
      expect(body).toContain('to=919876543210');
      expect(body).toContain('from=SAKYAFRM');
      expect(body).toContain('123456');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws when Vonage returns a non-zero status', async () => {
    const config = { get: vi.fn(() => null) } as unknown as ConfigService;
    const service = new VonageSmsService(config);
    (service as unknown as { apiKey: string }).apiKey = 'key-1';
    (service as unknown as { apiSecret: string }).apiSecret = 'secret-1';

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ status: '9', 'error-text': 'invalid sender id' }] }), {
        status: 200,
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(service.send('+919876543210', '123456')).rejects.toThrow('invalid sender id');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
