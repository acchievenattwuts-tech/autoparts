import assert from "node:assert/strict";
import test from "node:test";
import type { FormEvent } from "react";
import { submitFormData } from "../submit-form-data";

// Master forms moved from `<form action={fn}>` (which React resets after every
// action, even a rejected one) to onSubmit. The handler must stop the native
// submit and hand the caller the form's own FormData.
test("submitFormData prevents the native submit and passes the form's FormData", () => {
  const OriginalFormData = globalThis.FormData;
  const formElement = { tagName: "FORM" };
  class RecordingFormData {
    constructor(readonly source: unknown) {}
  }
  globalThis.FormData = RecordingFormData as unknown as typeof FormData;
  try {
    let prevented = 0;
    const received: unknown[] = [];
    submitFormData(
      {
        preventDefault: () => {
          prevented += 1;
        },
        currentTarget: formElement,
      } as unknown as FormEvent<HTMLFormElement>,
      (formData) => received.push(formData),
    );

    assert.equal(prevented, 1);
    assert.equal(received.length, 1);
    assert.ok(received[0] instanceof RecordingFormData);
    assert.equal((received[0] as RecordingFormData).source, formElement);
  } finally {
    globalThis.FormData = OriginalFormData;
  }
});
