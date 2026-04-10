<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
# Print Form Sync Rule

When changing the invoice / delivery-note print form at `app/admin/(protected)/sales/[id]/page.tsx`, you must also update `app/admin/delivery/print/page.tsx` in the same round. These two pages intentionally use the same document form and must stay in sync. Do not ship a change that updates only one of them.
<!-- END:nextjs-agent-rules -->
