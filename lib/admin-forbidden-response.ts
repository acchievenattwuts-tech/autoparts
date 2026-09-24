/**
 * The response the proxy returns when decideAdminRouteAccess() denies a
 * signed-in user (lib/admin-route-access.ts). It is a real 403 rather than a
 * redirect: a redirect target such as /admin can itself be denied for the same
 * user (it needs workboard.view, and a STAFF account without an app role is
 * denied everywhere), which would loop.
 *
 * - A browser page load gets a small HTML page.
 * - Everything else — RSC navigations, link prefetches, Server Action posts,
 *   fetch() — gets JSON. For an RSC navigation the Next.js router treats the
 *   non-RSC reply as a hard navigation, so the user still lands on the HTML
 *   page; a prefetch simply fails quietly and is retried on click.
 */

const FORBIDDEN_STATUS = 403;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

const FORBIDDEN_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>ไม่มีสิทธิ์เข้าถึงหน้านี้</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:system-ui,sans-serif;background:#f8fafc;color:#1f2937}
main{max-width:28rem;border:1px solid #e5e7eb;border-radius:16px;background:#fff;padding:28px 24px;text-align:center}
h1{font-size:1.05rem;margin:0 0 12px}
p{font-size:.9rem;line-height:1.6;color:#6b7280;margin:0 0 16px}
a{color:#1e3a5f;font-weight:600}
@media (prefers-color-scheme: dark){body{background:#020617;color:#f1f5f9}main{background:#0f172a;border-color:rgba(255,255,255,.1)}p{color:#94a3b8}a{color:#7dd3fc}}
</style>
</head>
<body>
<main>
<h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>
<p>บัญชีของคุณยังไม่ได้รับสิทธิ์ใช้งานหน้านี้ หากจำเป็นต้องใช้งาน กรุณาติดต่อผู้ดูแลระบบ</p>
<p><a href="/admin">กลับหน้าหลัก</a> · <a href="/admin/login">เข้าสู่ระบบด้วยบัญชีอื่น</a></p>
</main>
</body>
</html>
`;

type HeaderSource = Pick<Headers, "get">;

export const isBrowserDocumentRequest = (headers: HeaderSource): boolean => {
  if (headers.get("rsc") || headers.get("next-router-prefetch") || headers.get("next-action")) {
    return false;
  }
  const destination = headers.get("sec-fetch-dest");
  if (destination) return destination === "document";
  return (headers.get("accept") ?? "").includes("text/html");
};

export const buildAdminForbiddenResponse = (request: Pick<Request, "headers">): Response => {
  if (isBrowserDocumentRequest(request.headers)) {
    return new Response(FORBIDDEN_HTML, {
      status: FORBIDDEN_STATUS,
      headers: { ...NO_STORE_HEADERS, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return Response.json({ error: "FORBIDDEN" }, { status: FORBIDDEN_STATUS, headers: NO_STORE_HEADERS });
};
