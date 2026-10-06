import { PasswordHasher } from './password-hasher.service';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes and verifies a correct password', async () => {
    const hash = await hasher.hash('correct-horse-battery');
    await expect(hasher.verify(hash, 'correct-horse-battery')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hasher.hash('correct-horse-battery');
    await expect(hasher.verify(hash, 'wrong-password')).resolves.toBe(false);
  });
});
