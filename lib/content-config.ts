function normalizeEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getContentConfig() {
  const appBaseUrl =
    normalizeEnv(process.env.APP_BASE_URL) ??
    normalizeEnv(process.env.NEXTAUTH_URL) ??
    normalizeEnv(process.env.NEXT_PUBLIC_APP_URL);

  const openAiApiKey = normalizeEnv(process.env.OPENAI_API_KEY);
  const openAiModel = normalizeEnv(process.env.OPENAI_MODEL) ?? "gpt-5.4-mini";
  const qstashToken = normalizeEnv(process.env.QSTASH_TOKEN);
  const qstashCurrentSigningKey = normalizeEnv(process.env.QSTASH_CURRENT_SIGNING_KEY);
  const qstashNextSigningKey = normalizeEnv(process.env.QSTASH_NEXT_SIGNING_KEY);
  const facebookPageId = normalizeEnv(process.env.FACEBOOK_PAGE_ID);
  const facebookPageAccessToken = normalizeEnv(process.env.FACEBOOK_PAGE_ACCESS_TOKEN);

  return {
    appBaseUrl,
    openAiApiKey,
    openAiModel,
    qstashToken,
    qstashCurrentSigningKey,
    qstashNextSigningKey,
    facebookPageId,
    facebookPageAccessToken,
  };
}

export function getContentRuntimeStatus() {
  const config = getContentConfig();

  return {
    appBaseUrlReady: Boolean(config.appBaseUrl),
    openAiReady: Boolean(config.openAiApiKey),
    qstashReady: Boolean(
      config.qstashToken && config.qstashCurrentSigningKey && config.qstashNextSigningKey
    ),
    facebookReady: Boolean(config.facebookPageId && config.facebookPageAccessToken),
    appBaseUrl: config.appBaseUrl,
    openAiModel: config.openAiModel,
  };
}
