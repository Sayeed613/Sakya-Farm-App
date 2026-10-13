import { createHash } from 'node:crypto';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { OtpSenderService } from '../src/modules/auth/services/otp-sender.service';
import { OtpService } from '../src/modules/auth/services/otp.service';
import { PrismaService } from '../src/database/prisma.service';

function validPhone(value: string): string {
  if (!/^\+91\d{10}$/.test(value)) throw new Error('invalid phone');
  return value;
}

function createPrismaMock() {
  return {
    otpCode: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(async (arg: unknown) => arg),
  };
}

function otpRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'otp-1',
    phone: PHONE,
    tokenHash: '',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    attempts: 0,
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    ...overrides,
  } as any;
}

const PHONE = '+915555000001';

function hashOf(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function createConfig(
  overrides: {
    isProduction?: boolean;
    demoModeEnabled?: boolean;
    demoCode?: string;
    testOtpEnabled?: boolean;
    testOtpPhone?: string;
    testOtpCode?: string;
    testOtpDeadline?: string;
  } = {},
) {
  return {
    getOrThrow: (key: string) => {
      if (key === 'app.isProduction') return overrides.isProduction ?? false;
      throw new Error(`unexpected config key ${key}`);
    },
    get: (key: string) => {
      if (key === 'app.isProduction') return overrides.isProduction ?? false;
      if (key === 'sms.demoMode') return overrides.demoModeEnabled ?? false;
      if (key === 'sms.demoCode') return overrides.demoCode ?? '123456';
      // Temporary exact-test-number path: absent unless a test opts in.
      if (key === 'testOtp.enabled') return overrides.testOtpEnabled ?? false;
      if (key === 'testOtp.testPhone') return overrides.testOtpPhone;
      if (key === 'testOtp.code') return overrides.testOtpCode;
      if (key === 'testOtp.enabledDeadline') return overrides.testOtpDeadline;
      throw new Error(`unexpected config key ${key}`);
    },
  } as unknown as ConfigService;
}

function arrangeSendHappyPath(prisma: ReturnType<typeof createPrismaMock>) {
  prisma.otpCode.findFirst.mockResolvedValue(null);
  prisma.$transaction.mockResolvedValue([]);
  prisma.otpCode.create.mockResolvedValue({ id: 'otp-1' });
  prisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
}

/**
 * Focused unit tests for the development demo OTP path and the production
 * rejection path. These exercise the services directly with mocked Prisma —
 * no database, no environment files touched.
 *
 * Contract under test:
 * - demo mode issues a FIXED SIX-DIGIT code (same shape as production);
 * - demo codes go through the identical hash/store/verify pipeline;
 * - `devCode` is echoed only outside production;
 * - `NODE_ENV=production` hard-refuses demo mode regardless of OTP_DEMO_MODE.
 */
describe('OtpService demo mode — 6-digit development flow', () => {
  it('issues a fixed 6-digit demo code, stores only its hash, and echoes it as devCode', async () => {
    const config = createConfig({ demoModeEnabled: true });
    const sender = { send: vi.fn(async () => ({ accepted: true })), lastDevCode: '123456' };
    const prisma = createPrismaMock();
    arrangeSendHappyPath(prisma);

    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    const service = module.get(OtpService);
    const result = await service.send(validPhone(PHONE));

    expect(result.accepted).toBe(true);
    expect(sender.send).toHaveBeenCalledWith(PHONE, '123456');
    // The test-number code is carried in the response devCode.
    expect(result.phone).toBe(PHONE);
    expect(result.devCode).toBe('123456');
    const created = prisma.otpCode.create.mock.calls[0]![0] as { data: { tokenHash: string } };
    expect(created.data.tokenHash).toBe(hashOf('123456'));
  });

  it('verifies the fixed 6-digit demo code through the real hash pipeline; a wrong 6-digit code is rejected', async () => {
    const config = createConfig({ demoModeEnabled: true });
    const sender = { send: vi.fn(async () => ({ accepted: true })), lastDevCode: '123456' };
    const prisma = createPrismaMock();
    arrangeSendHappyPath(prisma);

    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    const service = module.get(OtpService);

    await service.send(validPhone(PHONE));
    const correct = (sender.send.mock.calls[0] as unknown as [string, string])[1];

    // Correct code: consumed exactly once.
    prisma.otpCode.count.mockResolvedValue(0);
    prisma.otpCode.findFirst.mockResolvedValue(otpRow({ tokenHash: hashOf(correct) }));
    prisma.otpCode.update.mockResolvedValue({});
    await expect(service.verify(validPhone(PHONE), correct)).resolves.toBeUndefined();

    // Wrong 6-digit code: generic failure, never accepted.
    prisma.otpCode.findFirst.mockResolvedValue(otpRow({ tokenHash: hashOf(correct) }));
    await expect(service.verify(validPhone(PHONE), '000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('issues a random 6-digit code outside demo mode and never echoes a devCode', async () => {
    const config = createConfig({ isProduction: false, demoModeEnabled: false });
    const sender = { send: vi.fn(async () => ({ accepted: true })), lastDevCode: null };
    const prisma = createPrismaMock();
    arrangeSendHappyPath(prisma);

    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    const service = module.get(OtpService);
    const result = await service.send(validPhone(PHONE));    const code = (sender.send.mock.calls[0] as unknown as [string, string])[1];
    expect(code).toMatch(/^\d{6}$/);
    // No dev code is echoed for a non-test phone.
    expect(result.devCode).toBeUndefined();
  });

  it('ignores demo mode in production (NODE_ENV=production) and issues a random 6-digit code', async () => {
    const config = createConfig({ isProduction: true, demoModeEnabled: true });
    const sender = { send: vi.fn(async () => ({ accepted: true })), lastDevCode: null };
    const prisma = createPrismaMock();
    arrangeSendHappyPath(prisma);

    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    const service = module.get(OtpService);
    const result = await service.send(validPhone(PHONE));
    const code = (sender.send.mock.calls[0] as unknown as [string, string])[1];
    expect(code).toMatch(/^\d{6}$/);


    expect(code).not.toBe('123456');
    // The random code reaches the wire but never the response body in prod.
    expect(sender.lastDevCode).toBeNull();
    // No dev code is echoed for a non-test phone.
    expect(result.devCode).toBeUndefined();
  });

  it('honours a custom OTP_DEMO_CODE, which must stay 6 digits', async () => {
    const config = createConfig({ demoModeEnabled: true, demoCode: '987654' });
    const sender = { send: vi.fn(async () => ({ accepted: true })), lastDevCode: '987654' };
    const prisma = createPrismaMock();
    arrangeSendHappyPath(prisma);

    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    const service = module.get(OtpService);
    const result = await service.send(validPhone(PHONE));

    expect(result.accepted).toBe(true);
    expect(sender.send).toHaveBeenCalledWith(PHONE, '987654');
    // The custom demo code is carried in the response devCode.
    expect(result.devCode).toBe('987654');
  });
});

describe('OtpSenderService — production rejection of demo/dev delivery', () => {
  it('fails closed in production even when demo mode is misconfigured on', async () => {
    const config = createConfig({ isProduction: true, demoModeEnabled: true });
    const msg91 = { configured: false, send: vi.fn() };
    const sender = new OtpSenderService(config, msg91 as never);

    const error = await sender.send(validPhone(PHONE), '123456').catch((e: unknown) => e);

    // The demo branch must be unreachable in production: no code is "accepted",
    // no dev code is recorded — the caller gets a retryable 503 instead.
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect(sender.lastDevCode).toBeNull();
    expect(msg91.send).not.toHaveBeenCalled();
  });

  it('records lastDevCode in non-production demo mode so devCode can be echoed', async () => {
    const config = createConfig({ isProduction: false, demoModeEnabled: true });
    const msg91 = { configured: false, send: vi.fn() };
    const sender = new OtpSenderService(config, msg91 as never);

    const result = await sender.send(validPhone(PHONE), '123456');

    expect(result.accepted).toBe(true);
    expect(sender.lastDevCode).toBe('123456');
    expect(msg91.send).not.toHaveBeenCalled();
  });

  it('never records lastDevCode on the real MSG91 path, even when it succeeds in production', async () => {
    const config = createConfig({ isProduction: true, demoModeEnabled: false });
    const msg91 = { configured: true, send: vi.fn(async () => true) };
    const sender = new OtpSenderService(config, msg91 as never);

    const result = await sender.send(validPhone(PHONE), '123456');

    // The MSG91 path never records lastDevCode, in any environment —
    // so production echo-by-devCode is impossible regardless of NODE_ENV.
    expect(result.accepted).toBe(true);
    expect(sender.lastDevCode).toBeNull();
  });

  it('short-circuits demo mode before the provider even when MSG91 is configured', async () => {
    const config = createConfig({ isProduction: false, demoModeEnabled: true });
    const msg91 = { configured: true, send: vi.fn(async () => true) };
    const sender = new OtpSenderService(config, msg91 as never);

    const result = await sender.send(validPhone(PHONE), '123456');

    // Restored HEAD behaviour: demo mode never hands the code to a provider.
    expect(msg91.send).not.toHaveBeenCalled();
    expect(result.accepted).toBe(true);
    expect(sender.lastDevCode).toBe('123456');
  });

  it('never records a development code when demo mode is disabled and no provider exists', async () => {
    // This config mirrors a non-production deployment where the sender is
    // replaced by a stub: OtpSenderService is directly instantiated here, so
    // it must not record anything on its own when demo mode is off.
    const config = createConfig({ isProduction: false, demoModeEnabled: false });
    const msg91 = { configured: true, send: vi.fn(async () => true) };
    const sender = new OtpSenderService(config, msg91 as never);

    const result = await sender.send(validPhone(PHONE), '000000');

    expect(result.accepted).toBe(true);
    expect(sender.lastDevCode).toBeNull();
  });
});

/* ============================================================
   TEMPORARY EXACT TEST OTP — one phone, one fixed code
============================================================ */

describe('OtpService temporary exact-test-number path', () => {
  const TEST_PHONE = '+915555000999';
  const TEST_CODE = '424242';
  const OTHER_PHONE = '+915555000001';

  function futureDeadline(): string {
    return new Date(Date.now() + 60_000).toISOString();
  }

  function createTestService(options: { isProduction?: boolean; deadline?: string; enabled?: boolean } = {}) {
    const prisma = createPrismaMock();
    // The dev delivery hook records the code it logged; emulate the real
    // sender so the response hook can be exercised end to end.
    const sender = {
      send: vi.fn(async (_phone: string, code: string) => {
        (sender as { lastDevCode: string | null }).lastDevCode = code;
        return { accepted: true };
      }),
      lastDevCode: null as string | null,
    };
    const config = createConfig({
      isProduction: options.isProduction,
      testOtpEnabled: options.enabled ?? true,
      testOtpPhone: TEST_PHONE,
      testOtpCode: TEST_CODE,
      testOtpDeadline: options.deadline ?? futureDeadline(),
    });

    return Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    })
      .compile()
      .then((module) => ({ service: module.get(OtpService), prisma, sender }));
  }

  it('issues the fixed test code to the exact configured phone and echoes it as devCode', async () => {
    const { service, prisma, sender } = await createTestService();
    arrangeSendHappyPath(prisma);

    const result = await service.send(TEST_PHONE);

    expect(sender.send).toHaveBeenCalledWith(TEST_PHONE, TEST_CODE);
    expect(result.devCode).toBe(TEST_CODE);
    // Only the hash is persisted, same pipeline as every other code.
    const created = prisma.otpCode.create.mock.calls[0]![0] as { data: { tokenHash: string } };
    expect(created.data.tokenHash).toBe(hashOf(TEST_CODE));
  });

  it('verifies the fixed test code through the normal single-use pipeline', async () => {
    const { service, prisma } = await createTestService();
    arrangeSendHappyPath(prisma);

    await service.send(TEST_PHONE);

    prisma.otpCode.count.mockResolvedValue(0);
    prisma.otpCode.findFirst.mockResolvedValue(otpRow({ phone: TEST_PHONE, tokenHash: hashOf(TEST_CODE) }));
    prisma.otpCode.update.mockResolvedValue({});
    await expect(service.verify(TEST_PHONE, TEST_CODE)).resolves.toBeUndefined();
    expect(prisma.otpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('issues a random code to every other phone even when the test path is enabled', async () => {
    const { service, prisma, sender } = await createTestService();
    arrangeSendHappyPath(prisma);

    const result = await service.send(OTHER_PHONE);

    const code = (sender.send.mock.calls[0] as unknown as [string, string])[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe(TEST_CODE);
    // The dev channel may echo the DELIVERED code, but never the fixed
    // test code — that one is reserved for the exact configured phone.
    expect(result.devCode).not.toBe(TEST_CODE);
  });

  it('falls back to random codes once the deadline has passed', async () => {
    const { service, prisma, sender } = await createTestService({
      deadline: new Date(Date.now() - 1_000).toISOString(),
    });
    arrangeSendHappyPath(prisma);

    const result = await service.send(TEST_PHONE);

    const code = (sender.send.mock.calls[0] as unknown as [string, string])[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe(TEST_CODE);
    // The dev channel may echo the DELIVERED code, but never the fixed
    // test code — that one is reserved for the exact configured phone.
    expect(result.devCode).not.toBe(TEST_CODE);
  });

  it('never issues the fixed test code in production even when fully configured', async () => {
    const { service, prisma, sender } = await createTestService({ isProduction: true });
    arrangeSendHappyPath(prisma);

    const result = await service.send(TEST_PHONE);

    const code = (sender.send.mock.calls[0] as unknown as [string, string])[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe(TEST_CODE);
    // The production response never carries a dev code at all.
    expect(result.devCode).toBeUndefined();
    // The stored hash matches the random code that was issued, not the test code.
    const created = prisma.otpCode.create.mock.calls[0]![0] as { data: { tokenHash: string } };
    expect(created.data.tokenHash).toBe(hashOf(code));
    expect(created.data.tokenHash).not.toBe(hashOf(TEST_CODE));
  });

  it('falls back to random codes when the feature flag is off', async () => {
    const { service, prisma, sender } = await createTestService({ enabled: false });
    arrangeSendHappyPath(prisma);

    const result = await service.send(TEST_PHONE);

    const code = (sender.send.mock.calls[0] as unknown as [string, string])[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe(TEST_CODE);
    // The dev channel may echo the DELIVERED code, but never the fixed
    // test code — that one is reserved for the exact configured phone.
    expect(result.devCode).not.toBe(TEST_CODE);
  });
});
