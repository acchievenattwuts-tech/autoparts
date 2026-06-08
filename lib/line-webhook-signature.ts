import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLineWebhookSignature(params: {
  channelSecret: string;
  body: string;
  signature: string | null;
}) {
  const { channelSecret, body, signature } = params;

  if (!signature) {
    return false;
  }

  const expected = createHmac("sha256", channelSecret).update(body).digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
