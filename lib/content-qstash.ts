import { Client, Receiver } from "@upstash/qstash";
import { getContentConfig } from "@/lib/content-config";

export function getQStashClient() {
  const { qstashToken } = getContentConfig();
  if (!qstashToken) {
    throw new Error("QSTASH_TOKEN_NOT_CONFIGURED");
  }

  return new Client({ token: qstashToken });
}

export function getQStashReceiver() {
  const { qstashCurrentSigningKey, qstashNextSigningKey } = getContentConfig();
  if (!qstashCurrentSigningKey || !qstashNextSigningKey) {
    throw new Error("QSTASH_SIGNING_KEYS_NOT_CONFIGURED");
  }

  return new Receiver({
    currentSigningKey: qstashCurrentSigningKey,
    nextSigningKey: qstashNextSigningKey,
  });
}
