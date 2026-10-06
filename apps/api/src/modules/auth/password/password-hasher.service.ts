import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordHasher {
  private dummyHashPromise: Promise<string> | null = null;

  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /**
   * Used to reduce obvious timing differences when an email does not exist.
   */
  async verifyDummy(password: string): Promise<void> {
    const dummyHash = await this.getDummyHash();
    try {
      await argon2.verify(dummyHash, password);
    } catch {
      // Ignore verification failures for the dummy hash.
    }
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = argon2.hash('hector-dummy-password-not-used', {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      });
    }

    return this.dummyHashPromise;
  }
}
