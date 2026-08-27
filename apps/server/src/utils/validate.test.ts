import { describe, expect, it } from 'vitest';
import { isValidEmail } from './validate.js';

describe('isValidEmail', () => {
  it('returns false for non-string input (number)', () => {
    expect(isValidEmail(42)).toBe(false);
  });

  it('returns false for non-string input (null)', () => {
    expect(isValidEmail(null)).toBe(false);
  });

  it('returns false for non-string input (object)', () => {
    expect(isValidEmail({})).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('returns false for a string longer than 254 characters', () => {
    const long = 'a'.repeat(246) + '@b.com'; // 246+1+1+1+3=252... make it >254
    expect(isValidEmail('a'.repeat(250) + '@b.com')).toBe(false);
  });

  it('returns false for a string without @', () => {
    expect(isValidEmail('notanemail')).toBe(false);
  });

  it('returns false for a string without a domain dot', () => {
    expect(isValidEmail('user@nodot')).toBe(false);
  });

  it('returns true for a valid email', () => {
    expect(isValidEmail('alice@example.com')).toBe(true);
  });

  it('returns true for a valid email with subdomain', () => {
    expect(isValidEmail('a.b+tag@sub.example.org')).toBe(true);
  });
});
