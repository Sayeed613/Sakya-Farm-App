import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { Msg91SmsService } from '../src/modules/auth/services/msg91-sms.service';
import { OtpSenderService } from '../src/modules/auth/services/otp-sender.service';

/**
 * Delivery routing rules:
 * - MSG91 configured -> always real send (any environment)
 * - not configured + production -> fail closed
 * - not configured + development -> log the code, set lastDevCode
 */
function createSender(options: {
  isProduction: boolean;
  msg91Configured: boolean;
  msg91Send?: ReturnType<typeof vi.fn>;
}): OtpSenderService {
  const config = {
    getOrThrow: vi.fn((_key: string) => options.isProduction),
  } as unknown as ConfigService;
  const msg91 = {
    configured: options.msg91Configured,
    send: options.msg91Send ?? vi.fn(async () => true),
  } as unknown as Msg91SmsService;
  return new OtpSenderService(config, msg91);
}

describe('OtpSenderService delivery routing', () => {
  it('uses MSG91 when configured, even outside production', async () => {
    const msg91Send = vi.fn(async () => true);
    const sender = createSender({ isProduction: false, msg91Configured: true, msg91Send });

    const result = await sender.send('+919876543210', '123456');

    expect(msg91Send).toHaveBeenCalledWith('+919876543210', '123456');
    expect(result.accepted).toBe(true);
    // The dev-response channel must stay empty on the real path.
    expect(sender.lastDevCode).toBeNull();
  });

  it('propagates MSG91 rejections instead of pretending success', async () => {
    const msg91Send = vi.fn(async () => {
      throw new Error('MSG91 rejected the OTP send: template not found');
    });
    const sender = createSender({ isProduction: false, msg91Configured: true, msg91Send });

    await expect(sender.send('+919876543210', '123456')).rejects.toThrow('template not found');
  });

  it('fails closed in production without a provider', async () => {
    const sender = createSender({ isProduction: true, msg91Configured: false });

    await expect(sender.send('+919876543210', '123456')).rejects.toThrow('SMS provider is not configured');
    expect(sender.lastDevCode).toBeNull();
  });

  it('logs the code in development when no provider is configured', async () => {
    const sender = createSender({ isProduction: false, msg91Configured: false });

    const result = await sender.send('+919876543210', '654321');

    expect(result.accepted).toBe(true);
    expect(sender.lastDevCode).toBe('654321');
  });
});

describe('Msg91SmsService.send', () => {
  function createService(overrides: Partial<{ authKey: string | null; otpTemplateId: string | null; from: string }> = {}) {
    const config = {
      get: vi.fn((key: string) => {
        // `key in overrides` (not ??) so an explicit null override is honored.
        if (key === 'sms.authKey') return 'authKey' in overrides ? (overrides.authKey ?? null) : 'authkey-1';
        if (key === 'sms.otpTemplateId') return 'otpTemplateId' in overrides ? (overrides.otpTemplateId ?? null) : 'template-1';
        if (key === 'sms.from') return overrides.from ?? 'SAKYAFRM';
        return null;
      }),
    } as unknown as ConfigService;
    return new Msg91SmsService(config);
  }

  it('posts the backend-generated code to the v5 OTP API with the template', async () => {
    const service = createService();

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ type: 'success', message: 'OTP sent' }), { status: 200 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const accepted = await service.send('+919876543210', '123456');
      expect(accepted).toBe(true);

      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://control.msg91.com/api/v5/otp');
      expect((init.headers as Record<string, string>).authkey).toBe('authkey-1');

      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.template_id).toBe('template-1');
      expect(body.mobile).toEqual(['919876543210']);
      // The API generates/stores its own code; MSG91 must deliver this exact one.
      expect(body.otp).toBe('123456');
      expect(body.sender).toBe('SAKYAFRM');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws when MSG91 answers with an error type', async () => {
    const service = createService();

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ type: 'error', message: 'template not found' }), { status: 200 }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(service.send('+919876543210', '123456')).rejects.toThrow('template not found');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws on a non-200 response', async () => {
    const service = createService();

    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(service.send('+919876543210', '123456')).rejects.toThrow('responded 403');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('is not configured unless both auth key and template are present', () => {
    expect(createService({ authKey: null }).configured).toBe(false);
    expect(createService({ otpTemplateId: null }).configured).toBe(false);
    expect(createService().configured).toBe(true);
  });
});
