# Product Multiple Images Plan

Scope: support multiple product images without breaking existing `Product.imageUrl` behavior.

## Checklist

- [x] Add `ProductImage` Prisma model linked to `Product`.
- [x] Keep `Product.imageUrl` as the primary/backward-compatible image.
- [x] Update admin product edit query to load existing product images.
- [x] Update admin product form to upload multiple images, preview thumbnails, remove images, and choose the primary image.
- [x] Update product create/update actions to persist image gallery and sync the primary image into `Product.imageUrl`.
- [x] Update storefront product query to load image gallery.
- [x] Update storefront product detail page to render zoom-on-hover main image and thumbnails when multiple images exist.
- [x] Run Prisma validation/generate and production build.
- [x] Push schema to database with `npx prisma db push`.

## Non-Goals

- No drag-and-drop reorder in this phase.
- No image deletion from Supabase storage in this phase.
- No changes to product search or stock logic.
