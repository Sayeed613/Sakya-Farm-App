import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { Msg91SmsService } from '../src/modules/auth/services/msg91-sms.service';
import { OtpSenderService } from '../src/modules/auth/services/otp-sender.service';

/**
 * Delivery routing rules:
 * - MSG91 configured -> always real send (any environment)
 * - not configured + production -> fail closed with a retryable 503
 * - not configured + development -> log the code, set lastDevCode
 * Provider failures never surface as a bare 500: the caller gets 503 and the
 * cause is logged.
 */
function createSender(options: {
  isProduction: boolean;
  msg91Configured: boolean;
  msg91Send?: ReturnType<typeof vi.fn>;
  demoMode?: boolean;
}): OtpSenderService {
  const config = {
    getOrThrow: vi.fn((_key: string) => options.isProduction),
    // The sender reads sms.demoMode via config.get; the routing tests exercise
    // real delivery, so demo mode stays off unless a test opts in.
    get: vi.fn((key: string) => key === 'sms.demoMode' && options.demoMode === true),
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

  it('answers 503 for an MSG91 rejection instead of pretending success', async () => {
    const msg91Send = vi.fn(async () => {
      throw new Error('MSG91 rejected the OTP send: template not found');
    });
    const sender = createSender({ isProduction: false, msg91Configured: true, msg91Send });

    const error = await sender.send('+919876543210', '123456').catch((e: unknown) => e);

    // Rejection is still propagated — as a retryable status, with the
    // provider's detail kept out of the response body.
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).message).not.toContain('MSG91');
    expect(sender.lastDevCode).toBeNull();
  });

  it('fails closed in production without a provider, with a retryable 503', async () => {
    const sender = createSender({ isProduction: true, msg91Configured: false });

    const error = await sender.send('+919876543210', '123456').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect(sender.lastDevCode).toBeNull();
  });

  it('short-circuits demo mode before the provider even when MSG91 is configured', async () => {
    const msg91Send = vi.fn(async () => true);
    const sender = createSender({
      isProduction: false,
      msg91Configured: true,
      msg91Send,
      demoMode: true,
    });

    const result = await sender.send('+919876543210', '123456');

    // Demo mode never hands the code to a provider outside production.
    expect(msg91Send).not.toHaveBeenCalled();
    expect(result.accepted).toBe(true);
    expect(sender.lastDevCode).toBe('123456');
  });

  it('logs the code in development when no provider is configured', async () => {
    const sender = createSender({ isProduction: false, msg91Configured: false });

    const result = await sender.send('+919876543210', '654321');

    expect(result.accepted).toBe(true);
    expect(result.devCode).toBe('654321');
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

/**
 * Temporary exact-test-number path: one explicitly-configured phone receives
 * one fixed code through the dev delivery hook, only while the deadline is
 * active. Every other phone keeps the generic dev fallback.
 */
describe('OtpSenderService — temporary exact-test-number path', () => {
  const TEST_PHONE = '+915555000999';
  const TEST_CODE = '424242';

  function createTestSender(options: {
    enabled?: boolean;
    deadline?: Date;
    isProduction?: boolean;
    msg91Configured?: boolean;
  }): OtpSenderService {
    const deadlineIso = (options.deadline ?? new Date(Date.now() + 60_000)).toISOString();
    const config = {
      getOrThrow: vi.fn(() => options.isProduction ?? false),
      get: vi.fn((key: string) => {
        if (key === 'testOtp.enabled') return options.enabled ?? true;
        if (key === 'testOtp.testPhone') return TEST_PHONE;
        if (key === 'testOtp.code') return TEST_CODE;
        if (key === 'testOtp.enabledDeadline') return deadlineIso;
        return false;
      }),
    } as unknown as ConfigService;
    const msg91 = {
      configured: options.msg91Configured ?? false,
      send: vi.fn(async () => true),
    } as unknown as Msg91SmsService;
    return new OtpSenderService(config, msg91);
  }

  it('serves the fixed code to the exact configured phone while the deadline is active', async () => {
    const sender = createTestSender({});

    const result = await sender.send(TEST_PHONE, '000000');

    expect(result.accepted).toBe(true);
    expect(result.devCode).toBe(TEST_CODE);
    expect(sender.lastDevCode).toBe(TEST_CODE);
  });

  it('never serves the test code to any other phone', async () => {
    const sender = createTestSender({});

    const result = await sender.send('+915555000001', '654321');

    expect(result.devCode).toBe('654321');
    expect(sender.lastDevCode).toBe('654321');
  });

  it('ignores the test path once the deadline has passed', async () => {
    const sender = createTestSender({ deadline: new Date(Date.now() - 1_000) });

    const result = await sender.send(TEST_PHONE, '654321');

    expect(result.devCode).toBe('654321');
    expect(sender.lastDevCode).toBe('654321');
  });

  it('ignores the test path when the feature flag is off', async () => {
    const sender = createTestSender({ enabled: false });

    const result = await sender.send(TEST_PHONE, '654321');

    expect(result.devCode).toBe('654321');
    expect(sender.lastDevCode).toBe('654321');
  });

  it('never substitutes the test code in production, even fully configured', async () => {
    const msg91Send = vi.fn(async () => true);
    // Production + configured provider + fully configured test path.
    const withProvider = new OtpSenderService(
      {
        getOrThrow: vi.fn(() => true),
        get: vi.fn((key: string) => {
          if (key === 'testOtp.enabled') return true;
          if (key === 'testOtp.testPhone') return TEST_PHONE;
          if (key === 'testOtp.code') return TEST_CODE;
          if (key === 'testOtp.enabledDeadline') return new Date(Date.now() + 60_000).toISOString();
          return false;
        }),
      } as unknown as ConfigService,
      { configured: true, send: msg91Send } as unknown as Msg91SmsService,
    );
    const result = await withProvider.send(TEST_PHONE, '654321');

    // The random code issued by the service goes to the real provider;
    // the fixed test code is never issued or recorded in production.
    expect(msg91Send).toHaveBeenCalledWith(TEST_PHONE, '654321');
    expect(result.devCode).toBeUndefined();
    expect(withProvider.lastDevCode).toBeNull();
  });

  it('still fails closed in production even for the configured test phone', async () => {
    const sender = createTestSender({ isProduction: true });

    const error = await sender.send(TEST_PHONE, TEST_CODE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect(sender.lastDevCode).toBeNull();
  });
});
