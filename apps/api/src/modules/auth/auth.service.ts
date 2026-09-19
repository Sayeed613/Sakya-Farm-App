import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { AuthSessionResponse, AuthUser } from '@sakya/types';
import type {
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterRequest,
} from '@sakya/validation';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PasswordHasherService } from './services/password-hasher.service';
import { OtpService } from './services/otp.service';
import type { OtpSendResponse } from '@sakya/types';

function expiresIn(value: string): JwtSignOptions['expiresIn'] {
  return value as unknown as JwtSignOptions['expiresIn'];
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The identity fields a session is issued for. Email is nullable because
 * phone-authenticated customers never had one, and phone is nullable because
 * operator accounts (seeded admins) may not have one.
 */
type SessionIdentity = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string | null;
};

@Injectable()
export class AuthService {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  private readonly refreshSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly otpService: OtpService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('auth.issuer');
    this.audience = config.getOrThrow<string>('auth.audience');
    this.accessTtl = config.getOrThrow<string>('auth.accessTtl');
    this.refreshTtl = config.getOrThrow<string>('auth.refreshTtl');
    this.refreshSecret = config.getOrThrow<string>('auth.refreshSecret');
  }

  /**
   * `POST /auth/otp/send` — issue a phone verification code.
   *
   * Thin pass-through: the OtpService owns the security rules. The response is
   * identical whether or not the phone has an account, so it cannot be used to
   * enumerate customers.
   */
  async sendOtp(
    phone: string,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<OtpSendResponse> {
    return this.otpService.send(phone, metadata);
  }

  /**
   * `POST /auth/otp/verify` — the customer authentication event.
   *
   * Verifying the code IS signing in: an existing customer is authenticated,
   * and an unknown phone gets an account created on the fly (PENDING first
   * name, CUSTOMER role, phone marked verified). No password, no registration
   * step. Profile completion is a later, optional, authenticated edit.
   */
  async verifyOtpAndAuthenticate(
    phone: string,
    code: string,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthSessionResponse> {
    // Throws on invalid/expired/burned codes; nothing below runs otherwise.
    await this.otpService.verify(phone, code, metadata);

    const user = await this.findOrCreateCustomerByPhone(phone, metadata);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    return this.issueSession(user, metadata, undefined, this.prisma, {
      isNewUser: user.created,
    });
  }

  /**
   * Find the customer for a verified phone, or provision one.
   *
   * The role grant and the user row are created together; a failure between
   * them would leave a role-less user who can authenticate but do nothing, so
   * the whole creation runs in one transaction.
   */
  private async findOrCreateCustomerByPhone(
    phone: string,
    metadata?: { ipAddress?: string; userAgent?: string },
  ): Promise<SessionIdentity & { created: boolean }> {
    const existing = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true },
    });

    if (existing !== null) {
      return { ...existing, created: false };
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone,
          email: null,
          // A real name arrives through profile completion; the phone's tail
          // keeps the account renderable until then.
          firstName: 'Customer',
          lastName: null,
          status: 'ACTIVE',
          phoneVerifiedAt: new Date(),
          roles: {
            create: { role: { connect: { code: 'CUSTOMER' } } },
          },
        },
        select: { id: true, email: true, phone: true, firstName: true, lastName: true },
      });
      return user;
    });

    // Keep the parameter referenced so lint does not flag it when metadata is
    // reserved for future provisioning audit fields.
    void metadata;

    return { ...created, created: true };
  }

  /**
   * `GET /users/me` — the caller's own profile.
   */
  async getProfile(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true },
    });

    if (user === null) {
      throw new UnauthorizedException('Authentication failed: account no longer exists');
    }

    return this.toAuthUser(user);
  }

  /**
   * `PATCH /users/me` — minimal profile completion for a phone-first customer.
   */
  async updateProfile(userId: string, input: { firstName?: string; lastName?: string | null; email?: string | null }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true },
    });

    if (user === null) {
      throw new UnauthorizedException('Authentication failed: account no longer exists');
    }

    if (input.email !== undefined && input.email !== null) {
      const clash = await this.prisma.user.findFirst({
        where: { email: input.email, id: { not: userId } },
        select: { id: true },
      });
      if (clash !== null) {
        throw new ConflictException('An account with that email already exists');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
      },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true },
    });

    return this.toAuthUser(updated);
  }

  async register(input: RegisterRequest, metadata?: { ipAddress?: string; userAgent?: string }) {
    const passwordHash = await this.passwordHasher.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          status: 'ACTIVE',
          roles: {
            create: {
              role: { connect: { code: 'CUSTOMER' } },
            },
          },
        },
        select: { id: true, email: true, phone: true, firstName: true, lastName: true },
      });
      return this.issueSession(user, metadata);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with that email already exists');
      }
      throw error;
    }
  }

  async login(input: LoginRequest, metadata?: { ipAddress?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, passwordHash: true, status: true },
    });
    const valid = user?.passwordHash !== null && user?.passwordHash !== undefined
      ? await this.passwordHasher.verify(input.password, user.passwordHash)
      : false;
    if (!valid || user === null || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueSession(user, metadata);
  }

  async refresh(input: RefreshRequest, metadata?: { ipAddress?: string; userAgent?: string }) {
    let payload: { sub: string; typ: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(input.refreshToken, {
        secret: this.refreshSecret,
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['HS256'],
      }) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.typ !== 'refresh' || !payload.sid) throw new UnauthorizedException('Invalid refresh token');

    const tokenHash = hashRefreshToken(input.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, phone: true, firstName: true, lastName: true, status: true } } },
    });
    if (stored === null || stored.userId !== payload.sub || stored.revokedAt !== null || stored.expiresAt <= new Date()) {
      if (stored !== null && stored.revokedAt !== null) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'Refresh token replay detected' },
        });
      }
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');

    return this.prisma.$transaction(async (tx) => {
      const next = await this.issueSession(stored.user, metadata, stored.familyId, tx);
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date(), revokedReason: 'Rotated', replacedByTokenHash: hashRefreshToken(next.refreshToken) },
      });
      return next;
    });
  }

  async logout(input: LogoutRequest) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(input.refreshToken), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'Logout' },
    });
    return { success: true };
  }

  private async issueSession(
    user: SessionIdentity,
    metadata?: { ipAddress?: string; userAgent?: string },
    existingFamilyId?: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
    options?: { isNewUser?: boolean },
  ): Promise<AuthSessionResponse> {
    const familyId = existingFamilyId ?? randomUUID();
    // `jti` makes every minted token unique even when two are signed in the
    // same second for the same user and family: JWT iat ticks in seconds, so
    // without a jti a rotation issued in the same second as its parent
    // produces an identical token string and collides on the unique
    // `token_hash` column. Unique tokens are also what makes replay detection
    // sound — a replayed token must never be ambiguous with a live sibling.
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, typ: 'access', sid: familyId, jti: randomUUID() },
      { expiresIn: expiresIn(this.accessTtl), issuer: this.issuer, audience: this.audience, algorithm: 'HS256' },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, typ: 'refresh', sid: familyId, jti: randomUUID() },
      { secret: this.refreshSecret, expiresIn: expiresIn(this.refreshTtl), issuer: this.issuer, audience: this.audience, algorithm: 'HS256' },
    );
    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    await client.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        familyId,
        expiresAt: new Date(decoded.exp * 1000),
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
      },
    });
    return {
      user: this.toAuthUser(user),
      accessToken,
      refreshToken,
      accessTokenExpiresIn: this.accessTtl,
      refreshTokenExpiresIn: this.refreshTtl,
      isNewUser: options?.isNewUser ?? false,
    };
  }

  private toAuthUser(user: SessionIdentity): AuthUser {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
