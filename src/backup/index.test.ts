// This file previously contained integration tests that were moved to index.integration.test.ts
// to prevent module mocking interference with unit tests.
//
// Integration tests use mock.module() which creates persistent mocks that can interfere
// with unit tests in other files. By separating them, we maintain proper test isolation.