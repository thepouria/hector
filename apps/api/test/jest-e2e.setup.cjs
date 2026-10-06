/**
 * Runs before any e2e test file is evaluated.
 * AuthController @Throttle reads NODE_ENV at decoration time; .env defaults to
 * development (limit 10/min) which flakes the full suite under shared IP tracking.
 */
process.env.NODE_ENV = 'test';
process.env.SWAGGER_ENABLED = 'false';
