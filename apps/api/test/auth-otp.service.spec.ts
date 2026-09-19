import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerException } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../src/database/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { OtpSenderService } from '../src/modules/auth/services/otp-sender.service';
import { OtpService } from '../src/modules/auth/services/otp.service';
import { PasswordHasherService } from '../src/modules/auth/services/password-hasher.service';

/**
 * Unit tests for the phone OTP flow, on mocked Prisma: the security rules
 * (cooldowns, attempt caps, single-use, hashing) are what matter here, and the
 * HTTP-level behaviour is covered by the e2e specs that run against a real DB.
 */

const PHONE = '+919876543210';

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
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    store: { findFirst: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return arg;
      if (typeof arg === 'function') return arg(prismaTxMock());
      return arg;
    }),
  };
}

function prismaTxMock() {
  return {
    user: {
      create: vi.fn(async () => ({
        id: 'user-new',
        email: null,
        phone: PHONE,
        firstName: 'Customer',
        lastName: null,
      })),
    },
    refreshToken: { create: vi.fn() },
  };
}

describe('OtpService', () => {
  let service: OtpService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let sender: { send: ReturnType<typeof vi.fn>; lastDevCode: string | null };

  beforeEach(async () => {
    prisma = createPrismaMock();
    sender = { send: vi.fn(async () => ({ accepted: true })), lastDevCode: null };

    const config = {
      getOrThrow: (key: string) => {
        if (key === 'app.isProduction') return false;
        throw new Error(`unexpected config key ${key}`);
      },
      get: (key: string) => (key === 'sms.demoMode' ? false : undefined),
    } as unknown as ConfigService;

    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(OtpService);
  });

  it('issues a 6-digit code, stores only a hash, and reports the dev code outside production', async () => {
    prisma.otpCode.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue([]);
    prisma.otpCode.create.mockImplementation(async ({ data }: { data: { tokenHash: string } }) => data);
    prisma.otpCode.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.send(PHONE);

    expect(result.phone).toBe(PHONE);
    expect(result.resendAfterSeconds).toBe(60);
    expect(result.expiresInSeconds).toBe(300);
    // The stored hash can never be the plaintext code.
    const created = prisma.otpCode.create.mock.calls[0]![0] as { data: { tokenHash: string; expiresAt: Date } };
    expect(created.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.data.tokenHash).not.toContain(sender.lastDevCode ?? '\u0000');
    // Supersedes previous active codes for the same phone.
    expect(prisma.otpCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ phone: PHONE, consumedAt: null }),
      }),
    );
    expect(sender.send).toHaveBeenCalledWith(PHONE, expect.any(String));
  });

  it('refuses a resend inside the cooldown window', async () => {
    prisma.otpCode.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) });

    await expect(service.send(PHONE)).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('verifies a valid code and consumes it exactly once', async () => {
    // Issue a code first so the hash matches. The mocked sender does not set
    // `lastDevCode`, so capture the plaintext from the send call itself.
    prisma.otpCode.findFirst.mockResolvedValue(null);
    prisma.otpCode.create.mockImplementation(async ({ data }: { data: { tokenHash: string } }) => data);
    prisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
    await service.send(PHONE);
    const code = sender.send.mock.calls[0]![1] as string;

    prisma.otpCode.count.mockResolvedValue(0);
    prisma.otpCode.findFirst.mockResolvedValue(otpRow({ tokenHash: hashOf(code) }));
    prisma.otpCode.update.mockResolvedValue({});

    await expect(service.verify(PHONE, code)).resolves.toBeUndefined();

    expect(prisma.otpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects a wrong code and burns the code after the attempt limit', async () => {
    prisma.otpCode.count.mockResolvedValue(0);

    // Stateful row: each verify reads and then writes the attempt count, so
    // the mock must carry state between calls just like the database would.
    let attempts = 0;
    prisma.otpCode.findFirst.mockImplementation(async () =>
      otpRow({ tokenHash: hashOf('123456'), attempts }),
    );
    prisma.otpCode.update.mockImplementation(async ({ data }: { data: { attempts: number; consumedAt?: Date } }) => {
      attempts = data.attempts;
      return {};
    });

    // Four wrong attempts: each throws, attempts increment, not yet consumed.
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(service.verify(PHONE, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
      const call = prisma.otpCode.update.mock.calls[attempt - 1]![0] as {
        data: { attempts: number; consumedAt?: Date };
      };
      expect(call.data.attempts).toBe(attempt);
      expect(call.data.consumedAt).toBeUndefined();
    }

    // Fifth wrong attempt: the code is consumed (burned).
    await expect(service.verify(PHONE, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
    const burn = prisma.otpCode.update.mock.calls[4]![0] as {
      data: { attempts: number; consumedAt?: Date };
    };
    expect(burn.data.consumedAt).toBeInstanceOf(Date);
  });

  it('never accepts a consumed code (single-use)', async () => {
    prisma.otpCode.count.mockResolvedValue(0);
    prisma.otpCode.findFirst.mockResolvedValue(null);

    await expect(service.verify(PHONE, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('never accepts an expired code', async () => {
    prisma.otpCode.count.mockResolvedValue(0);
    prisma.otpCode.findFirst.mockResolvedValue(null);

    await expect(service.verify(PHONE, '123456')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('caps verifications per phone per rolling hour', async () => {
    prisma.otpCode.count.mockResolvedValue(10);

    await expect(service.verify(PHONE, '123456')).rejects.toBeInstanceOf(ThrottlerException);
  });
});

describe('AuthService.verifyOtpAndAuthenticate', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;
  let otp: { verify: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    prisma = createPrismaMock();
    otp = { verify: vi.fn(async () => undefined), send: vi.fn() };

    const config = {
      getOrThrow: (key: string) => {
        const values: Record<string, string> = {
          'auth.issuer': 'test-issuer',
          'auth.audience': 'test-audience',
          'auth.accessTtl': '15m',
          'auth.refreshTtl': '30d',
          'auth.refreshSecret': 'x'.repeat(40),
        };
        if (key in values) return values[key]!;
        throw new Error(`unexpected config key ${key}`);
      },
    } as unknown as ConfigService;

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: PasswordHasherService, useValue: { hash: vi.fn(), verify: vi.fn() } },
        { provide: OtpService, useValue: otp },
        { provide: ConfigService, useValue: config },
        {
          provide: JwtService,
          useValue: {
            signAsync: async (payload: Record<string, unknown>) => JSON.stringify(payload),
            decode: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            verifyAsync: async () => ({}),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('creates a CUSTOMER account on first verification and reports isNewUser', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({});
    const tx = prismaTxMock();
    prisma.$transaction.mockImplementation((async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(tx)) as unknown as typeof prisma.$transaction);
    prisma.refreshToken.create.mockResolvedValue({});

    const session = await service.verifyOtpAndAuthenticate(PHONE, '123456');

    expect(session.isNewUser).toBe(true);
    expect(session.user.phone).toBe(PHONE);
    expect(session.user.email).toBeNull();
    expect(session.accessToken).toBeDefined();
    expect(session.refreshToken).toBeDefined();
    expect(tx.user.create).toHaveBeenCalledTimes(1);
  });

  it('authenticates an existing phone customer without creating anything', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: null,
      phone: PHONE,
      firstName: 'Ananya',
      lastName: null,
    });
    prisma.user.update.mockResolvedValue({});
    prisma.refreshToken.create.mockResolvedValue({});

    const session = await service.verifyOtpAndAuthenticate(PHONE, '123456');

    expect(session.isNewUser).toBe(false);
    expect(session.user.firstName).toBe('Ananya');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses to authenticate when verification fails', async () => {
    otp.verify.mockRejectedValue(new UnauthorizedException('Invalid or expired code'));

    await expect(service.verifyOtpAndAuthenticate(PHONE, '000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

/* ============================================================
   DEMO OTP MODE — fixed 4-digit code, non-production only
============================================================ */

describe('OtpService demo mode', () => {
  function createDemoService(demoMode: boolean, isProduction = false) {
    const prisma = createPrismaMock();
    const sender = { send: vi.fn(async () => ({ accepted: true })), lastDevCode: null as string | null };

    const config = {
      getOrThrow: (key: string) => {
        if (key === 'app.isProduction') return isProduction;
        throw new Error(`unexpected config key ${key}`);
      },
      get: (key: string) => (key === 'sms.demoMode' ? demoMode : undefined),
    } as unknown as ConfigService;

    return Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: prisma },
        { provide: OtpSenderService, useValue: sender },
        { provide: ConfigService, useValue: config },
      ],
    })
      .compile()
      .then((module) => ({
        service: module.get(OtpService),
        prisma,
        sender,
      }));
  }

  function arrangeHappyPath(prisma: ReturnType<typeof createPrismaMock>) {
    prisma.otpCode.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockResolvedValue([]);
    prisma.otpCode.create.mockImplementation(async ({ data }: { data: { tokenHash: string } }) => data);
    prisma.otpCode.updateMany.mockResolvedValue({ count: 0 });
  }

  it('issues the fixed 4-digit demo code when demo mode is enabled', async () => {
    const { service, prisma, sender } = await createDemoService(true);
    arrangeHappyPath(prisma);

    await service.send(PHONE);

    // The exact demo code goes out on the sender channel.
    expect(sender.send).toHaveBeenCalledWith(PHONE, '1234');
    // And only its hash is persisted.
    const created = prisma.otpCode.create.mock.calls[0]![0] as { data: { tokenHash: string } };
    expect(created.data.tokenHash).toBe(hashOf('1234'));
  });

  it('still verifies through the normal hash/single-use pipeline in demo mode', async () => {
    const { service, prisma } = await createDemoService(true);
    arrangeHappyPath(prisma);
    await service.send(PHONE);

    // Wrong 4-digit code: generic failure, attempt recorded.
    prisma.otpCode.findFirst.mockResolvedValue(
      otpRow({ tokenHash: hashOf('1234') }),
    );
    prisma.otpCode.update.mockResolvedValue({});
    await expect(service.verify(PHONE, '9999')).rejects.toBeInstanceOf(UnauthorizedException);

    // Correct code: consumed exactly once.
    prisma.otpCode.findFirst.mockResolvedValue(
      otpRow({ tokenHash: hashOf('1234') }),
    );
    prisma.otpCode.update.mockResolvedValue({});
    await expect(service.verify(PHONE, '1234')).resolves.toBeUndefined();
    expect(prisma.otpCode.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'otp-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
  });

  it('ignores demo mode in production and issues a random 6-digit code', async () => {
    const { service, prisma, sender } = await createDemoService(true, true);
    arrangeHappyPath(prisma);

    await service.send(PHONE);

    const code = (sender.send.mock.calls[0] as unknown as [string, string])[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(code).not.toBe('1234');
  });
});

function hashOf(code: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return createHash('sha256').update(code).digest('hex');
}
