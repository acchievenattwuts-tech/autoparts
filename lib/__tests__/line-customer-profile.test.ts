import test from "node:test";
import assert from "node:assert/strict";

type MaybeProfileModule = {
  isLineCustomerProfileIncomplete?: (input: {
    source: string | null | undefined;
    shippingAddress: string | null | undefined;
  }) => boolean;
};

const loadProfileModule = async (): Promise<MaybeProfileModule> => {
  try {
    return (await import("@/lib/line-customer-profile")) as MaybeProfileModule;
  } catch {
    return {};
  }
};

test("marks LINE_LIFF customers without shippingAddress as incomplete", async () => {
  const { isLineCustomerProfileIncomplete } = await loadProfileModule();

  assert.equal(
    isLineCustomerProfileIncomplete?.({
      source: "LINE_LIFF",
      shippingAddress: "",
    }),
    true,
  );
});

test("does not mark LINE_LIFF customers incomplete when shippingAddress exists", async () => {
  const { isLineCustomerProfileIncomplete } = await loadProfileModule();

  assert.equal(
    isLineCustomerProfileIncomplete?.({
      source: "LINE_LIFF",
      shippingAddress: "123 ถนนสุขุมวิท",
    }),
    false,
  );
});

test("does not mark non-LINE_LIFF customers incomplete from missing shippingAddress alone", async () => {
  const { isLineCustomerProfileIncomplete } = await loadProfileModule();

  assert.equal(
    isLineCustomerProfileIncomplete?.({
      source: "MANUAL",
      shippingAddress: "",
    }),
    false,
  );
});
