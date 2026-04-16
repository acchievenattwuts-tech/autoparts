import { getContentConfig } from "@/lib/content-config";
import type { ContentPost } from "@/lib/generated/prisma";

type PublishablePost = Pick<
  ContentPost,
  "caption" | "imageUrl" | "linkUrl" | "facebookPageId"
>;

async function publishTextPost(post: PublishablePost, accessToken: string) {
  const response = await fetch(`https://graph.facebook.com/v23.0/${post.facebookPageId}/feed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      access_token: accessToken,
      message: post.caption,
      ...(post.linkUrl ? { link: post.linkUrl } : {}),
    }),
  });

  const payload = (await response.json()) as { id?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message || "FACEBOOK_TEXT_PUBLISH_FAILED");
  }

  return payload.id;
}

async function publishPhotoPost(post: PublishablePost, accessToken: string) {
  const response = await fetch(`https://graph.facebook.com/v23.0/${post.facebookPageId}/photos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      access_token: accessToken,
      url: post.imageUrl ?? "",
      caption: post.caption,
      ...(post.linkUrl ? { link: post.linkUrl } : {}),
      published: "true",
    }),
  });

  const payload = (await response.json()) as { post_id?: string; id?: string; error?: { message?: string } };
  if (!response.ok || !(payload.post_id || payload.id)) {
    throw new Error(payload.error?.message || "FACEBOOK_PHOTO_PUBLISH_FAILED");
  }

  return payload.post_id ?? payload.id!;
}

export async function publishFacebookPagePost(post: PublishablePost) {
  const config = getContentConfig();
  const accessToken = config.facebookPageAccessToken;
  if (!accessToken) {
    throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN_NOT_CONFIGURED");
  }

  if (!post.facebookPageId) {
    throw new Error("FACEBOOK_PAGE_ID_NOT_CONFIGURED");
  }

  if (post.imageUrl) {
    return publishPhotoPost(post, accessToken);
  }

  return publishTextPost(post, accessToken);
}
