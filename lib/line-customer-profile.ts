type LineCustomerProfileInput = {
  source: string | null | undefined;
  shippingAddress: string | null | undefined;
};

export function isLineCustomerProfileIncomplete(input: LineCustomerProfileInput): boolean {
  return input.source === "LINE_LIFF" && !input.shippingAddress;
}
