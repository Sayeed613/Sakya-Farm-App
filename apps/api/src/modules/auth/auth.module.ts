import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { PasswordHasherService } from './services/password-hasher.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Authentication foundation.
 *
 * This pass deliberately stops at the mechanism: token verification, the
 * strategy that turns a token into an identity, and password hashing. The
 * sign-up / sign-in / refresh / sign-out endpoints are the next increment and
 * will live in this module, using the pieces assembled here plus the
 * `refresh_tokens` table.
 *
 * Note `session: false`: tokens are carried in the Authorization header, not in
 * a cookie, because the primary clients are mobile apps.
 */

/**
 * TTLs come from configuration as validated strings (`15m`, `30d`), while
 * `@nestjs/jwt` types `expiresIn` with `ms`'s template-literal type. This is the
 * single place that crossing is acknowledged.
 */
function asExpiresIn(value: string): JwtSignOptions['expiresIn'] {
  return value as unknown as JwtSignOptions['expiresIn'];
}

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('auth.accessSecret'),
        signOptions: {
          expiresIn: asExpiresIn(configService.getOrThrow<string>('auth.accessTtl')),
          issuer: configService.getOrThrow<string>('auth.issuer'),
          audience: configService.getOrThrow<string>('auth.audience'),
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  providers: [JwtStrategy, PasswordHasherService],
  exports: [JwtModule, PasswordHasherService],
})
export class AuthModule {}
