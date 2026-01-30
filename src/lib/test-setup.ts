// Test setup file for Vitest
// Provides browser-like globals for tests that import modules with browser dependencies

import { vi } from 'vitest';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

// @ts-ignore - Setting global for tests
globalThis.localStorage = localStorageMock;

// Mock sessionStorage
// @ts-ignore - Setting global for tests
globalThis.sessionStorage = localStorageMock;

// Mock window if needed
if (typeof globalThis.window === 'undefined') {
  // @ts-expect-error - Setting global for tests
  globalThis.window = {
    localStorage: localStorageMock,
    sessionStorage: localStorageMock,
  };
}
