import { Client, Receiver } from "@upstash/qstash";
import { getContentConfig } from "@/lib/content-config";

export function getQStashConfig() {
  const config = getContentConfig();

  return {
    appBaseUrl: config.appBaseUrl,
    qstashUrl: config.qstashUrl,
    qstashToken: config.qstashToken,
    qstashCurrentSigningKey: config.qstashCurrentSigningKey,
    qstashNextSigningKey: config.qstashNextSigningKey,
    ready: Boolean(
      config.appBaseUrl &&
      config.qstashUrl &&
      config.qstashToken &&
      config.qstashCurrentSigningKey &&
      config.qstashNextSigningKey
    ),
  };
}

export function getQStashClient() {
  const { qstashUrl, qstashToken } = getQStashConfig();
  if (!qstashUrl) {
    throw new Error("QSTASH_URL_NOT_CONFIGURED");
  }
  if (!qstashToken) {
    throw new Error("QSTASH_TOKEN_NOT_CONFIGURED");
  }

  return new Client({ baseUrl: qstashUrl, token: qstashToken });
}

export function getQStashReceiver() {
  const { qstashCurrentSigningKey, qstashNextSigningKey } = getQStashConfig();
  if (!qstashCurrentSigningKey || !qstashNextSigningKey) {
    throw new Error("QSTASH_SIGNING_KEYS_NOT_CONFIGURED");
  }

  return new Receiver({
    currentSigningKey: qstashCurrentSigningKey,
    nextSigningKey: qstashNextSigningKey,
  });
}
