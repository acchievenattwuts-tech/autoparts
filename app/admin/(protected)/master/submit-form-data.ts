import type { FormEvent } from "react";

/**
 * Submit handler for admin master forms that keeps what the user typed when the
 * Server Action rejects the input. Call it from `onSubmit`:
 * `onSubmit={(event) => submitFormData(event, handleCreate)}`.
 *
 * `<form action={fn}>` makes React 19 reset every uncontrolled field once the
 * action's transition settles — whether the action succeeded or returned
 * `{ error }` — so a duplicate-name error arrived with an emptied (create) or
 * reverted (edit) form. Submitting through `onSubmit` keeps the fields; every
 * caller resets or closes its form itself on success. Native `required` / `min`
 * validation still runs, because the browser validates before firing `submit`.
 */
export const submitFormData = (
  event: FormEvent<HTMLFormElement>,
  handler: (formData: FormData) => void,
): void => {
  event.preventDefault();
  handler(new FormData(event.currentTarget));
};
