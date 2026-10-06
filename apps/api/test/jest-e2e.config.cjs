/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: '.e2e-spec.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  testEnvironment: 'node',
  watchman: false,
  // Force NODE_ENV=test before any suite imports AppModule (Throttle decoration).
  setupFiles: ['<rootDir>/test/jest-e2e.setup.cjs'],
  // Nest bootstrap + syncPermissions can exceed Jest's 5s default under full-suite load.
  testTimeout: 60_000,
  // Some suites leave open handles (DB pool / Nest); exit after assertions so CI can finish.
  forceExit: true,
};
