/**
 * Jest Setup: Mock Redis (ioredis) globally
 * Prevents real Redis connections during testing
 */

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    // Mock Redis client methods
    hset: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    hgetall: jest.fn().mockResolvedValue({}),
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    ping: jest.fn().mockResolvedValue('PONG'),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
    off: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    flushdb: jest.fn().mockResolvedValue('OK'),
    flushall: jest.fn().mockResolvedValue('OK'),
  }));
});

// Prevent open handles warnings
jest.setTimeout(10000);
