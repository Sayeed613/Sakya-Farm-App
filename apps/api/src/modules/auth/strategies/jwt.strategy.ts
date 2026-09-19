import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { isPermissionCode, isRoleCode } from '@sakya/types';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../database/prisma.service';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../../../common/types/authenticated-user';

/**
 * Verifies the access token and resolves the caller's effective access.
 *
 * Roles and permissions are read from the database on every request instead of
 * being copied into the token. That costs one indexed query per authenticated
 * request, and buys the property that revoking a role or permission takes effect
 * immediately rather than when the access token expires. Caching this lookup is
 * the intended next optimisation; correctness comes first.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('auth.accessSecret'),
      issuer: configService.getOrThrow<string>('auth.issuer'),
      audience: configService.getOrThrow<string>('auth.audience'),
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  override async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    // Defence in depth: refresh tokens are signed with a different secret, but a
    // token type check means a mix-up can never be used to authenticate.
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Authentication failed: wrong token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        status: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
      },
    });

    if (user === null) {
      throw new UnauthorizedException('Authentication failed: account no longer exists');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException(
        `Authentication failed: account is ${user.status.toLowerCase()}`,
      );
    }

    // Validated against the shared vocabularies rather than cast, so a row that
    // drifted from the seeded set simply grants nothing.
    const roles = user.roles.map((assignment) => assignment.role.code).filter(isRoleCode);
    const permissions = [
      ...new Set(
        user.roles.flatMap((assignment) =>
          assignment.role.permissions.map((entry) => entry.permission.code),
        ),
      ),
    ].filter(isPermissionCode);

    return {
      id: user.id,
      email: user.email ?? '',
      roles,
      permissions,
      isSuperAdmin: roles.includes('SUPER_ADMIN'),
    };
  }
}
