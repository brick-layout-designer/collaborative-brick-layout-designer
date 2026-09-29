// Budget preferences (PreferencesDialog.cpp:69, budget/defaultInfinite and
// general/warnBudgetLimitation) and the Budget reached box.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PreferencesDialog } from '../PreferencesDialog';
import { BudgetReachedDialog } from '../BudgetReachedDialog';
import { useEditorStore } from '../editorStore';

afterEach(() => {
  cleanup();
  useEditorStore.getState().setBudgetDefaultInfinite(true);
  useEditorStore.getState().setWarnBudgetLimitation(true);
});

describe('Preferences → General budget settings', () => {
  it('default to unlimited parts and a warning, and persist changes', () => {
    render(<PreferencesDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'General' }));
    const parts = screen.getByLabelText('Parts without a budget') as HTMLSelectElement;
    const warn = screen.getByLabelText('Warn when the budget refuses a part') as HTMLInputElement;
    expect(parts.value).toBe('unlimited');
    expect(warn.checked).toBe(true);

    fireEvent.change(parts, { target: { value: 'forbidden' } });
    fireEvent.click(warn);
    expect(useEditorStore.getState().budgetDefaultInfinite).toBe(false);
    expect(useEditorStore.getState().warnBudgetLimitation).toBe(false);
    expect(localStorage.getItem('cld:budgetDefaultInfinite')).toBe('false');
    expect(localStorage.getItem('cld:warnBudgetLimitation')).toBe('false');
  });
});

describe('Budget reached box', () => {
  it('OK keeps the warning on unless "don\'t show again" is ticked', () => {
    let closed = 0;
    const { unmount } = render(<BudgetReachedDialog onClose={() => closed++} />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(closed).toBe(1);
    expect(useEditorStore.getState().warnBudgetLimitation).toBe(true);
    unmount();

    render(<BudgetReachedDialog onClose={() => closed++} />);
    fireEvent.click(screen.getByLabelText("Don't show this message again"));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(closed).toBe(2);
    expect(useEditorStore.getState().warnBudgetLimitation).toBe(false);
  });
});
