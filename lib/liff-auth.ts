type LineIdTokenVerifyResponse = {
  sub?: string;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
};

const LINE_VERIFY_TIMEOUT_MS = 5000;

export type VerifiedLiffIdentity = {
  lineUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
};

function getLineLiffChannelId() {
  const channelId = process.env.LINE_LIFF_CHANNEL_ID;
  if (!channelId) {
    throw new Error("LINE_LIFF_CHANNEL_ID is not configured");
  }
  return channelId;
}

export async function verifyLiffIdToken(idToken: string): Promise<VerifiedLiffIdentity> {
  if (!idToken || idToken.length < 20) {
    throw new Error("INVALID_LIFF_ID_TOKEN");
  }

  const body = new URLSearchParams({
    id_token: idToken,
    client_id: getLineLiffChannelId(),
  });

  let response: Response;

  try {
    response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(LINE_VERIFY_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[liff-auth] LINE token verify request failed", error);
    throw new Error("LIFF_ID_TOKEN_VERIFY_FAILED");
  }

  const payload = (await response.json().catch(() => ({}))) as LineIdTokenVerifyResponse;

  if (!response.ok || !payload.sub) {
    throw new Error("LIFF_ID_TOKEN_VERIFY_FAILED");
  }

  return {
    lineUserId: payload.sub,
    displayName: payload.name ?? null,
    pictureUrl: payload.picture ?? null,
  };
}
