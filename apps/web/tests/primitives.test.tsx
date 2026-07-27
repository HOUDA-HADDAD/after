import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Field } from '@aftergame/ui';

/**
 * The two states a static screen never shows you.
 *
 * Busy and revealed only exist for the moment someone is waiting or looking, which is exactly why
 * they are the states that rot: nothing in a screenshot, a storybook page or a page-level test
 * notices when they stop working. These are the tests that do.
 */

describe('a button that is working', () => {
  it('says so, without dropping the label out of the layout', () => {
    const { rerender } = render(
      <Button pending={false} onClick={vi.fn()}>
        Submit answer
      </Button>,
    );

    const idle = screen.getByRole('button', { name: 'Submit answer' });

    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle).not.toBeDisabled();

    rerender(
      <Button pending onClick={vi.fn()}>
        Submit answer
      </Button>,
    );

    const busy = screen.getByRole('button', { name: 'Submit answer' });

    // Announced, and un-clickable, so a slow network cannot become a double submission.
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();

    // The label is still in the tree rather than swapped out. That is what holds the button's
    // width while it spins — replacing it would resize the control mid-click and shift the row.
    expect(busy).toHaveTextContent('Submit answer');
    expect(busy.querySelector('svg')).not.toBeNull();
  });

  it('cannot be clicked while it is working', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button pending onClick={onClick}>
        Submit
      </Button>,
    );

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('a password field', () => {
  const renderField = () =>
    render(
      <Field
        id="password"
        label="Password"
        type="password"
        required
        revealLabels={{ show: 'Show password', hide: 'Hide password' }}
      />,
    );

  it('lets you check what you typed, and hide it again', async () => {
    const user = userEvent.setup();
    renderField();

    const input = screen.getByLabelText(/Password/);

    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Show password' });

    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);

    // A revealed password really is a text input — masking it with CSS would leave the characters
    // available to anything reading the DOM and still hidden from the person who asked to see them.
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Hide password' }));

    expect(input).toHaveAttribute('type', 'password');
  });

  it('keeps the toggle out of the way of the keyboard', () => {
    renderField();

    // Tabbing out of the password field should reach the submit button, not a convenience that a
    // keyboard user has no need for — they can already see what they typed by other means.
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('tabindex', '-1');
  });

  it('marks itself required without saying it twice', () => {
    renderField();

    const input = screen.getByLabelText(/Password/);

    // `required` is what assistive technology reads.
    expect(input).toBeRequired();

    // And the asterisk is for eyes only: the accessible name stays "Password", so the field is
    // never announced as "Password star". This is the assertion that would fail if the marker
    // were added as plain text instead of an aria-hidden one.
    expect(input).toHaveAccessibleName('Password');
  });
});
