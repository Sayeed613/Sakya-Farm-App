import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash, parseOptions, verify, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * `@node-rs/argon2` declares `Algorithm` as an *ambient const enum*, which cannot
 * be referenced as a value when `isolatedModules` is enabled. Argon2id is value
 * `2` and is also the library default; naming it here keeps the choice explicit
 * instead of implicit.
 */
const ARGON2ID = 2 as Algorithm;

/**
 * Password hashing with Argon2id.
 *
 * Argon2id is the OWASP-recommended algorithm for new applications: it is
 * memory-hard, so GPU cracking is expensive, while still resisting side-channel
 * attacks. Parameters are configuration, not constants, so they can be raised
 * later without a code change — `needsRehash` detects hashes created under an
 * older policy so they can be upgraded the next time the user signs in.
 *
 * A password is never logged, never stored, and never returned by this service.
 */
@Injectable()
export class PasswordHasherService {
  private readonly options: Options;

  constructor(configService: ConfigService) {
    this.options = {
      algorithm: ARGON2ID,
      memoryCost: configService.getOrThrow<number>('auth.argon2.memoryKib'),
      timeCost: configService.getOrThrow<number>('auth.argon2.timeCost'),
      parallelism: configService.getOrThrow<number>('auth.argon2.parallelism'),
    };
  }

  /** Hash a plaintext password into a self-describing PHC string. */
  async hash(plainPassword: string): Promise<string> {
    return hash(plainPassword, this.options);
  }

  /**
   * Verify a plaintext password against a stored digest.
   *
   * Argument order is (password, hash) — the reverse of the underlying library,
   * which takes the digest first. Note that `options` is passed for algorithm
   * selection only; the cost parameters are read from the digest itself, so
   * existing hashes keep verifying after the policy is raised.
   *
   * Returns false rather than throwing on a malformed digest: a corrupted column
   * must fail closed, not surface as a 500 that leaks its existence.
   */
  async verify(plainPassword: string, passwordHash: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plainPassword, this.options);
    } catch {
      return false;
    }
  }

  /**
   * True when the digest was produced with weaker parameters than the current
   * policy, meaning it should be re-hashed after a successful sign-in.
   */
  needsRehash(passwordHash: string): boolean {
    try {
      const parsed = parseOptions(passwordHash);
      return (
        parsed.algorithm !== ARGON2ID ||
        parsed.memoryCost !== this.options.memoryCost ||
        parsed.timeCost !== this.options.timeCost ||
        parsed.parallelism !== this.options.parallelism
      );
    } catch {
      // An unparseable digest cannot be trusted and must be replaced.
      return true;
    }
  }
}
