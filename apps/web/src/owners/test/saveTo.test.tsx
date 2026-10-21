// @vitest-environment jsdom
// "Save to" offers only the clubs that will take it: a club that keeps
// adding to its admins is left out for its members, and a starting value
// that points at one falls back to Me.

import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { OrgSummary } from '../../api';
import { SaveToPicker } from '../OwnerControls';

afterEach(cleanup);

const club = (slug: string, canAdd?: boolean): OrgSummary => ({ id: slug, slug, name: slug.toUpperCase(), createdAt: 1, myRole: 'member', ...(canAdd === undefined ? {} : { canAdd }) });

it('leaves out clubs that only their admins add to, and falls back to Me', () => {
  const onChange = vi.fn();
  render(<SaveToPicker value="shut" onChange={onChange} orgs={[club('shut', false), club('open', true), club('old')]} />);
  const options = screen.getAllByRole('option').map((o) => o.textContent);
  expect(options).toEqual(['Me', 'OPEN', 'OLD']);
  expect(onChange).toHaveBeenCalledWith('');
});

it('shows nothing when Me is the only choice', () => {
  const onChange = vi.fn();
  const { container } = render(<SaveToPicker value="" onChange={onChange} orgs={[]} />);
  expect(container.textContent).toBe('');
  expect(onChange).not.toHaveBeenCalled();
});

it('with only Me left, says why a club of mine isn’t offered (no picker, no dead end)', () => {
  const onChange = vi.fn();
  const { container } = render(<SaveToPicker value="" onChange={onChange} orgs={[club('shut', false)]} />);
  expect(container.querySelector('select')).toBeNull();
  expect(container.textContent).toMatch(/^It’s saved to your own things\..*isn’t listed: your roles there can’t add layouts\. Ask a club admin for the Start new club layouts permission\.$/);
  expect(onChange).not.toHaveBeenCalled();
});
