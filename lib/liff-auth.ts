type LineIdTokenVerifyResponse = {
  sub?: string;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
};

type LineAccessTokenVerifyResponse = {
  client_id?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type LineProfileResponse = {
  userId?: string;
  displayName?: string;
  pictureUrl?: string;
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

export async function verifyLiffAccessToken(accessToken: string): Promise<VerifiedLiffIdentity> {
  if (!accessToken || accessToken.length < 20) {
    throw new Error("INVALID_LIFF_ACCESS_TOKEN");
  }

  let verifyResponse: Response;

  try {
    verifyResponse = await fetch(
      `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(LINE_VERIFY_TIMEOUT_MS),
      },
    );
  } catch (error) {
    console.error("[liff-auth] LINE access token verify request failed", error);
    throw new Error("LIFF_ACCESS_TOKEN_VERIFY_FAILED");
  }

  const verifyPayload = (await verifyResponse.json().catch(() => ({}))) as LineAccessTokenVerifyResponse;

  if (!verifyResponse.ok || verifyPayload.client_id !== getLineLiffChannelId()) {
    throw new Error("LIFF_ACCESS_TOKEN_VERIFY_FAILED");
  }

  let profileResponse: Response;

  try {
    profileResponse = await fetch("https://api.line.me/v2/profile", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(LINE_VERIFY_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[liff-auth] LINE profile request failed", error);
    throw new Error("LIFF_ACCESS_TOKEN_PROFILE_FAILED");
  }

  const profile = (await profileResponse.json().catch(() => ({}))) as LineProfileResponse;

  if (!profileResponse.ok || !profile.userId) {
    throw new Error("LIFF_ACCESS_TOKEN_PROFILE_FAILED");
  }

  return {
    lineUserId: profile.userId,
    displayName: profile.displayName ?? null,
    pictureUrl: profile.pictureUrl ?? null,
  };
}

export async function verifyLiffIdentity(input: {
  idToken?: string | null;
  accessToken?: string | null;
}): Promise<VerifiedLiffIdentity> {
  const idToken = input.idToken ?? "";
  const accessToken = input.accessToken ?? "";

  if (idToken) {
    try {
      return await verifyLiffIdToken(idToken);
    } catch (error) {
      if (!accessToken) throw error;
      console.warn("[liff-auth] falling back to access token verification", error);
    }
  }

  return verifyLiffAccessToken(accessToken);
}
