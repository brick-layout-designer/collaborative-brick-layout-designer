import { describe, expect, it } from 'vitest';
import { escapeHtml, isValidEmail } from './validate.js';

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

describe('escapeHtml', () => {
  it('escapes a script tag so it cannot break out of a text-content sink', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a double quote so it cannot break out of a quoted attribute value', () => {
    // e.g. inviterName = `" onmouseover="alert(1)` interpolated into
    // href="${name}" — without escaping, the closing quote lets an
    // attacker inject a new attribute.
    expect(escapeHtml('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
  });

  it('escapes ampersands so entities are not double-decoded', () => {
    expect(escapeHtml('Bob & Alice')).toBe('Bob &amp; Alice');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("O'Brien")).toBe('O&#39;Brien');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Alice Wonderland')).toBe('Alice Wonderland');
  });
});
