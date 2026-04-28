<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
# Print Form Sync Rule

When changing the invoice / delivery-note print form at `app/admin/(protected)/sales/[id]/page.tsx`, you must also update `app/admin/delivery/print/page.tsx` in the same round. These two pages intentionally use the same document form and must stay in sync. Do not ship a change that updates only one of them.

When changing the receipt-form presentation (layout/styling/text blocks/signature section) for `app/admin/(protected)/sales/[id]/page.tsx`, you must also review and update `app/admin/(protected)/receipts/[id]/page.tsx` in the same round. These two pages render receipt documents with intentionally similar presentation and should stay aligned unless the task explicitly calls for a difference.

All admin print forms must follow a two-layer structure: shared print presentation primitives first, then document-specific content/logic on top. Do not introduce a new print page by copying a full layout block inline when it can use the shared print layer instead.

If a change touches any shared print primitive or any presentation line intentionally reused by multiple print forms, you must review and update every affected consumer in the same round. Do not ship shared print changes with one form left visually out of sync.

# Admin Theme Sync Rule

When changing UI/UX on any admin surface, you must review and update both light mode and dark mode in the same round automatically. Do not ask the human whether dark mode should also be updated â€” that is the default requirement. Apply theme changes carefully, preserve the existing business logic, and avoid letting one theme drift visually or behaviorally out of sync with the other.

# Quick Search Sync Rule

When adding, removing, renaming, regrouping, or changing access for any admin menu item or admin entrypoint, you must review and update Quick Search command coverage in the same round. The `>` command mode must stay in sync with the currently available admin menus and must continue to respect the same permission gating as the sidebar/navigation.

Admin navigation and Quick Search command entries must share the same source of truth whenever possible. Do not maintain a second hand-written list of navigable admin menu commands if it can be derived from the shared navigation config.

When introducing a new admin menu, admin page entrypoint, or user-facing admin workflow shortcut, add or derive its Quick Search coverage before shipping. Do not leave new functionality discoverable in the UI but missing from Quick Search.
<!-- END:nextjs-agent-rules -->
