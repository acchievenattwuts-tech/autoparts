# Knowledge Hub CMS

> สถานะล่าสุด 2026-07-30: Knowledge CMS ใช้งานจริงแล้ว และเพิ่ม safety baseline สำหรับ RAG ตาม [Knowledge RAG Roadmap](/D:/autoparts/docs/specs/knowledge-rag-roadmap.md) เรื่องประกัน/คืนสินค้า/ค่าจัดส่ง/การจัดส่งยังแสดงบน storefront ได้ แต่ถูกบล็อกจาก AI ที่ชั้น editor, server validation, approval และ publisher ส่วน Product Search ยังคงแยก logic และ embedding model เดิม

## Goal

สร้างระบบ Knowledge Hub แบบ database-first สำหรับบทความ SEO / AEO / AIO ของ storefront โดยแยกขาดจากระบบคอนเทนต์ Facebook เดิม เพื่อให้ AI และผู้ดูแลระบบสามารถร่าง ตรวจ อนุมัติ เผยแพร่ และวัดผลบทความความรู้ได้โดยไม่ต้อง deploy โค้ดทุกครั้ง

ระบบนี้ต้องรักษา trust-first behavior ของร้านศรีวรรณ อะไหล่แอร์: เนื้อหาต้องช่วยลูกค้าเตรียมข้อมูลก่อนสั่งซื้อ ตรวจรุ่นรถ / OEM / รูปอะไหล่ / อาการเสีย และพาลูกค้าไปยืนยันกับร้านผ่าน LINE OA หรือโทรศัพท์ ไม่ใช่ยืนยันความเข้ากันได้ สต็อก ราคา หรือข้อเท็จจริงที่ระบบไม่มีหลักฐานรองรับ

## Scope

- เพิ่ม source of truth ใหม่สำหรับบทความ Knowledge Hub ในฐานข้อมูล
- ย้าย public `/knowledge` และ `/knowledge/[slug]` จาก static array ไปอ่านบทความ `PUBLISHED` จาก database
- เพิ่ม admin workflow แยกสำหรับ Knowledge Hub: draft, edit, preview, request review, publish, archive
- เพิ่ม AI draft assistant สำหรับบทความ Knowledge Hub โดย output เป็น structured article ไม่ใช่ Facebook caption
- รักษา metadata, canonical, sitemap, Open Graph, `ArticleJsonLd`, internal links, และ `llms.txt` ให้สอดคล้องกับบทความที่ publish จริง
- เชื่อมโยง content backlog กับหลักฐานจริง เช่น Product Search no-result / low-result, LINE FAQ, LINE intent, และคำถามจากงานหน้าร้าน เมื่อข้อมูลพร้อม

## Out of Scope

- ห้ามรวมกับระบบ Facebook Content เดิมใน `ContentPost`
- ห้ามแก้ behavior ของ Facebook post generation, approval, schedule, QStash publish, หรือ Meta API
- ห้ามให้ AI auto-publish บทความ public โดยไม่มี human review
- ห้ามสร้าง dynamic RAG answer page หรือ chatbot ใหม่ในเฟสแรก
- ห้ามสร้าง keyword-stuffed landing pages ที่ไม่มีคำถามหรือหลักฐานจริงจากลูกค้า
- ห้ามอ้างว่าอะไหล่ตรงรุ่น ใช้แทนกันได้ มีสต็อก หรือราคาแน่นอน หากไม่มีข้อมูลยืนยันจากระบบหรือผู้ดูแล

## Current Code Reality

### Public Knowledge Source Today

ปัจจุบันบทความ Knowledge Hub เป็น static TypeScript data:

- `lib/knowledge-content.ts`
  - `KnowledgeArticle` interface
  - `knowledgeArticles` array
  - `knowledgeArticleMap`

Consumers สำคัญ:

- `app/knowledge/page.tsx`
  - import `knowledgeArticles`
  - ใช้เลือก featured article
  - group บทความตาม category
  - หา local SEO articles จาก title / description / relatedSearches
- `app/knowledge/[slug]/page.tsx`
  - import `knowledgeArticleMap` และ `knowledgeArticles`
  - ใช้ `generateStaticParams()`
  - ใช้ `generateMetadata()`
  - render article body, related articles, internal links, `BreadcrumbJsonLd`, `ArticleJsonLd`
  - มี `export const dynamic = "force-dynamic"` อยู่แล้ว แม้ content ยังเป็น static
- `app/knowledge/[slug]/opengraph-image.tsx`
  - ใช้ `knowledgeArticleMap` เพื่อสร้าง OG image ต่อ slug
- `app/sitemap.ts`
  - import `knowledgeArticles`
  - map article slug เข้า sitemap
  - file นี้ `force-dynamic` อยู่แล้ว
- `app/product/[productSlug]/page.tsx`
  - import `knowledgeArticles`
  - เลือกบทความ support 4 slug สำหรับ compatibility/OEM/photo-check section
  - ส่ง related knowledge URLs เข้า `ProductJsonLd`
- `app/products/[categorySlug]/page.tsx`
  - import `knowledgeArticles`
  - เลือก support articles ตาม category name ผ่าน title / description / intro / relatedSearches

ผลกระทบหลัก: ถ้าทำ database-first ต้องแทนที่ static import เหล่านี้ด้วย repository functions ที่เลือกเฉพาะ published article และต้องไม่ทำให้ internal links หาย

### Facebook Content System Today

ระบบ admin content ปัจจุบันเป็น Facebook-only:

- `prisma/schema.prisma`
  - `ContentPost`
  - `ContentApproval`
  - `ContentScheduledJob`
  - `ContentAuditLog`
  - `ContentChannel` มี `FACEBOOK_PAGE` เท่านั้น
- `app/admin/(protected)/content/actions.ts`
  - `createDraftVariants()` สร้าง `ContentPost` โดย hardcode `channel: "FACEBOOK_PAGE"`
  - `publishNow()` เรียก `publishFacebookPagePost()`
  - readiness check ผูกกับ `FACEBOOK_PAGE_ID`, Facebook access token, QStash, `APP_BASE_URL`
  - `revalidateContentPaths()` revalidate เฉพาะ admin content pages
- `lib/content-ai.ts`
  - prompt เน้น Facebook topic / caption
  - output เป็น `ContentDraftIdea` และ `ContentTopicIdea`
- `lib/content-config.ts`
  - runtime status ผูกกับ OpenAI, QStash, Facebook, App base URL
- `lib/content-facebook.ts`
  - publish ไป Meta Graph API
- `lib/content-line.ts`
  - approval notification link ไป `/admin/content/[id]`

ผลกระทบหลัก: ไม่ควร extend `ContentPost` เป็น Knowledge Article เพราะ field และ lifecycle ผูกกับ Facebook มากเกินไป จะทำให้ schema และ approval semantics สับสน

### Admin Navigation / Quick Search

admin navigation มี source กลาง:

- `lib/admin-navigation.ts`
  - เมนู "คอนเทนต์ Facebook" และ "คิวอนุมัติโพสต์" อยู่ในกลุ่ม "การตลาด & เว็บไซต์"
- `lib/quick-search-commands.ts`
  - derive navigate commands จาก `flattenAdminNavigation(ADMIN_NAVIGATION)`

ถ้าเพิ่ม Knowledge CMS ต้องเพิ่มเมนูใน `ADMIN_NAVIGATION` เพื่อให้ Quick Search command mode ได้ coverage อัตโนมัติ และต้องใช้ permission key เดียวกับ route guard

### Permissions / Audit

Facebook content permission ปัจจุบัน:

- `content.view`
- `content.create`
- `content.update`
- `content.manage`

labels เป็น Facebook ทั้งหมดใน `lib/access-control.ts`

Audit view ปัจจุบัน map:

- `ContentPost` -> "คอนเทนต์ Facebook"
- source href -> `/admin/content/[id]`

Knowledge CMS ต้องมี entity type แยก เช่น `KnowledgeArticle` และเพิ่ม audit label/source route แยก ไม่ใช้ `ContentPost`

## Required Architecture

### Separate Module Boundary

ให้ถือว่า Knowledge CMS เป็น module ใหม่ ไม่ใช่ channel ใหม่ของ Facebook content

Recommended folders:

- `app/admin/(protected)/knowledge/`
- `app/admin/(protected)/knowledge/[id]/`
- `app/admin/(protected)/knowledge/new/`
- `lib/knowledge-repository.ts`
- `lib/knowledge-ai.ts`
- `lib/knowledge-validation.ts`
- `lib/knowledge-public.ts` หรือ helper naming ใกล้เคียงตาม pattern repo

ห้ามเพิ่ม behavior ของ Knowledge เข้า `app/admin/(protected)/content/actions.ts` ยกเว้นถ้ามีเหตุผล migration ชั่วคราวที่ถูกบันทึกไว้ชัดเจน

### Data Model Draft

ชื่อ field อาจปรับได้ตอน implement แต่ intent ต้องคงไว้

```prisma
enum KnowledgeArticleStatus {
  DRAFT
  PENDING_REVIEW
  PUBLISHED
  ARCHIVED
}

enum KnowledgeArticleCategory {
  BUYING_GUIDE
  DIAGNOSIS
  WEBSITE_USAGE
  OEM_AND_FITMENT
  LOCAL_GUIDE
}

model KnowledgeArticle {
  id              String                 @id @default(cuid())
  slug            String                 @unique
  title           String
  description     String
  category        KnowledgeArticleCategory
  status          KnowledgeArticleStatus @default(DRAFT)
  readingMinutes  Int
  intro           String
  keyTakeaways    Json
  relatedSearches Json
  internalLinks   Json?
  evidenceJson    Json?
  aiDraftSource   String?
  publishedAt     DateTime?              @db.Timestamptz(3)
  archivedAt      DateTime?              @db.Timestamptz(3)
  createdByUserId String
  updatedByUserId String?
  publishedByUserId String?
  createdAt       DateTime               @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime               @updatedAt @db.Timestamptz(3)
  sections        KnowledgeArticleSection[]

  @@index([status, publishedAt])
  @@index([category, status])
  @@index([createdByUserId, createdAt])
}

model KnowledgeArticleSection {
  id        String           @id @default(cuid())
  articleId String
  sortOrder Int
  heading   String
  body      Json
  article   KnowledgeArticle @relation(fields: [articleId], references: [id], onDelete: Cascade)

  @@index([articleId, sortOrder])
}
```

Notes:

- ทุก `DateTime` ใหม่ต้องใช้ `@db.Timestamptz(3)`
- `keyTakeaways`, `relatedSearches`, `internalLinks`, `evidenceJson`, และ section body ใช้ `Json` ได้เพราะเป็น structured content ไม่ใช่ relation ที่ต้อง query หนักในเฟสแรก
- ถ้าต้อง query internal links หรือ evidence บ่อย ค่อย normalize เป็น relation ภายหลัง
- ห้ามใช้ `any` ใน TypeScript mapper ต้องมี Zod schema และ explicit types

### Public Article Shape

ต้องคง shape ที่ public UI ใช้งานได้ใกล้ `KnowledgeArticle` เดิม:

```ts
type PublicKnowledgeArticle = {
  slug: string;
  title: string;
  description: string;
  category: string;
  readingMinutes: number;
  publishedAt: string;
  updatedAt: string;
  intro: string;
  keyTakeaways: string[];
  sections: Array<{
    heading: string;
    body: string[];
  }>;
  relatedSearches: string[];
  internalLinks?: Array<{
    href: string;
    title: string;
    description: string;
  }>;
};
```

ให้ทำ mapper จาก Prisma row -> `PublicKnowledgeArticle` ใน repository ชั้นเดียว เพื่อไม่ให้ page components ต้อง parse Json เอง

## Public Rendering Requirements

### `/knowledge`

ต้องอ่านเฉพาะ `status = PUBLISHED`

Behavior ที่ต้องรักษา:

- featured article ยังมี fallback ถ้ายังไม่มีบทความ
- grouped by category
- local SEO section ยังเลือกจาก title / description / relatedSearches ได้ หรือเปลี่ยนเป็น field/tag ถ้าสร้างไว้
- metadata ของ hub ยัง canonical ไป `/knowledge`
- `BreadcrumbJsonLd` ยังอยู่

Performance:

- ใช้ `select` เฉพาะ field ที่ต้องแสดง
- เรียง `publishedAt desc` หรือ `sortOrder` ถ้าเพิ่ม field
- ถ้า article count เยอะ ให้เตรียม pagination แต่เฟสแรกอาจ list ทั้งหมดได้ถ้ายังน้อย

### `/knowledge/[slug]`

ต้องอ่านเฉพาะ published article ตาม slug

Behavior ที่ต้องรักษา:

- slug ไม่พบหรือไม่ published -> `notFound()`
- `generateMetadata()` ต้องใช้ DB article
- canonical ต้องเป็น `/knowledge/[slug]`
- Open Graph URL/image ต้องตรง slug
- related articles ต้องเป็น published เท่านั้น
- `ArticleJsonLd` ต้องตรงกับ visible content
- `datePublished` ใช้ `publishedAt`
- `dateModified` ใช้ `updatedAt`
- default recommended links ต้องไม่ link ไป draft/archived article

ถ้ายังใช้ dynamic rendering:

- ต้องคุม query ให้เบา
- ใช้ `revalidatePath()` หลัง publish/update/archive

ถ้าจะใช้ static generation:

- ต้องอ่าน Next.js local docs ก่อน เพราะ repo ระบุว่า Next.js version นี้อาจต่างจากความรู้เดิม
- ต้องวางแผน cache invalidation ให้ชัดก่อน implement

### Open Graph Image

`app/knowledge/[slug]/opengraph-image.tsx` ต้องอ่าน DB article หรือใช้ helper เดียวกับ detail metadata

ข้อควรระวัง:

- ถ้า article ไม่ published ต้อง `notFound()`
- อย่าให้ OG image ของ draft ถูก render ได้
- หลีกเลี่ยง query หนักใน image route

### Sitemap

`app/sitemap.ts` ต้องเปลี่ยนจาก static `knowledgeArticles.map` เป็น DB query:

- เฉพาะ `status = PUBLISHED`
- `lastModified = updatedAt`
- URL เป็น canonical `/knowledge/[slug]`
- priority ใกล้เดิม `0.75`
- `changeFrequency = "monthly"` เว้นแต่มีเหตุผลเปลี่ยน

### Product / Category Internal Links

ปัจจุบัน product page hardcode slug ของบทความ support 4 ตัว:

- `how-to-check-oem-part-number-before-ordering`
- `can-one-ac-part-fit-multiple-car-models`
- `how-to-compare-old-part-before-chatting-with-the-shop`
- `how-to-check-compressor-plug-pulley-and-mounting-points`

เมื่อย้ายเป็น DB:

- สร้าง helper เช่น `listPublishedKnowledgeArticlesBySlugs(slugs)`
- ต้อง preserve order ตาม slug list
- ถ้าบทความใด archived ให้ไม่แสดง link นั้น
- `ProductJsonLd.relatedLinks` ต้อง include เฉพาะ published links

Category page ปัจจุบัน match จาก content text:

- title
- description
- intro
- relatedSearches

เฟสแรกอาจคง matching แบบนี้ผ่าน public article shape ได้ แต่ระยะต่อไปควรเพิ่ม tags หรือ category relation เพื่อให้ precise กว่า

## Admin Requirements

### Routes

Required routes:

- `/admin/knowledge`
  - list article ทั้งหมด
  - filter status/category/query
  - ปุ่มสร้างใหม่
- `/admin/knowledge/new`
  - create manual draft หรือ AI-assisted draft
- `/admin/knowledge/[id]`
  - edit structured article
  - preview public rendering
  - request review / publish / archive
- `/admin/knowledge/approval-queue` optional
  - ถ้าต้องการแยก queue เหมือน Facebook content

ทุก route ใต้ `/app/admin/(protected)/` ต้องมี `loading.tsx`

### Permissions

เพิ่ม permission แยก:

- `knowledge.view`
- `knowledge.create`
- `knowledge.update`
- `knowledge.publish`
- `knowledge.archive`

ต้องทำครบตาม rule ของ repo:

1. เพิ่มใน `PERMISSION_CATALOG`
2. เพิ่ม default role permission ตามความเหมาะสม
3. เพิ่ม `ADMIN_ROUTE_RULES`
4. ใช้ `requirePermission()` ใน page/action
5. เพิ่ม `ADMIN_NAVIGATION`

Quick Search จะ derive จาก `ADMIN_NAVIGATION` อยู่แล้ว แต่ต้อง verify command mode หลังเพิ่มเมนู

### UI / Theme

ถ้า implement UI:

- ต้องรองรับ light/dark mode พร้อมกัน
- ใช้ admin component patterns เดิม
- หลีกเลี่ยง editor ที่ส่ง client bundle ใหญ่โดยไม่จำเป็น
- ถ้าใช้ textarea structured sections ในเฟสแรก ให้ทำง่ายและเสถียรก่อน
- ถ้ามี search/filter submit button ใน admin ต้องใช้ `AdminSearchForm` + `AdminSearchSubmitButton`

### Actions

Server Actions ใหม่ต้อง:

- `requirePermission()`
- validate ด้วย Zod
- wrap async operations ด้วย try/catch
- return Thai user-friendly errors
- write central `AuditLog` สำหรับ create/update/publish/archive
- call `revalidatePath()` เฉพาะ public/admin paths ที่เกี่ยวข้อง

Suggested actions:

- `createKnowledgeDraftAction`
- `updateKnowledgeDraftAction`
- `requestKnowledgeReviewAction`
- `publishKnowledgeArticleAction`
- `archiveKnowledgeArticleAction`
- `generateKnowledgeDraftAction`

ไม่ควรเรียก `publishFacebookPagePost()`, `getContentConfig().facebookPageId`, หรือ QStash Facebook publish flow

## AI Draft Requirements

### Separate AI Module

สร้าง `lib/knowledge-ai.ts` แยกจาก `lib/content-ai.ts`

Input ที่แนะนำ:

- topic
- targetIntent
- audience
- evidence notes
- source type: manual, product_search_log, line_faq, line_conversation_summary, admin_note
- related category/product slugs ที่ผู้ดูแลเลือก
- required caution notes

Output ต้องเป็น JSON เท่านั้น:

```json
{
  "title": "...",
  "slug": "...",
  "description": "...",
  "category": "OEM_AND_FITMENT",
  "readingMinutes": 4,
  "intro": "...",
  "keyTakeaways": ["...", "..."],
  "sections": [
    {
      "heading": "...",
      "body": ["...", "..."]
    }
  ],
  "relatedSearches": ["...", "..."],
  "internalLinks": [
    {
      "href": "/products/...",
      "title": "...",
      "description": "..."
    }
  ],
  "factualWarnings": ["..."]
}
```

### Prompt Rules

Prompt ต้องระบุ:

- เขียนภาษาไทย
- answer-first
- ห้ามอ้าง stock/price/compatibility แบบยืนยัน
- ต้องบอกให้ลูกค้าส่งรุ่นรถ ปีรถ รหัสเดิม หรือรูปอะไหล่เดิมเมื่อไม่แน่ใจ
- ต้องใช้ real shop context
- ต้องไม่ keyword-stuff
- ต้องไม่อ้างประสบการณ์ รีวิว หรือ credential ที่ไม่มีใน repo
- ต้องตอบเป็น JSON ล้วน

### Human Review Gate

AI draft ต้องเข้าบทความ status `DRAFT` หรือ `PENDING_REVIEW` เท่านั้น

ห้ามมีปุ่มหรือ job ที่ publish โดยอัตโนมัติจาก AI output โดยไม่มี user ที่มี `knowledge.publish`

## Evidence Sources

Knowledge CMS ควรอ่านหลักฐานจาก repo ที่มีอยู่ แต่ต้องเริ่มแบบ conservative

Potential sources:

- `ProductSearchLog`
  - no-result / low-result clusters
  - ใช้หา topic gap
- `ProductSearchReviewOutcome`
  - ดูว่าคำค้นไหนเคยแก้ด้วย alias/synonym/fitment แล้ว
- `LineMessage`
  - ใช้เฉพาะ summary หรือ query ที่ผ่าน privacy/safety filter
- `LineAiAuditLog`
  - ใช้ดู intent/action aggregate ได้
- manual admin notes
  - source ที่ปลอดภัยที่สุดสำหรับเฟสแรก

Privacy / safety:

- อย่าเอาข้อความลูกค้าส่วนตัวไป render public ตรง ๆ
- ถ้าดึงจาก LINE ให้ aggregate/summarize และ strip PII
- ห้ามใส่เบอร์ลูกค้า ชื่อไลน์ เลขเอกสาร หรือข้อมูลคำสั่งซื้อในบทความ

## Migration Plan

### Phase 1 - Database Read Model

- เพิ่ม schema `KnowledgeArticle` และ `KnowledgeArticleSection`
- สร้าง seed/backfill script จาก `lib/knowledge-content.ts`
- สร้าง repository mapper
- เปลี่ยน public `/knowledge`, `/knowledge/[slug]`, OG image, sitemap, product/category support article consumers ไปอ่าน DB
- คง `lib/knowledge-content.ts` ไว้ชั่วคราวเป็น migration source เท่านั้น
- validate ว่า URLs เดิมยังเปิดได้ทุก slug

### Phase 2 - Admin CRUD + Publish Workflow

- เพิ่ม admin routes และ loading states
- เพิ่ม permission/navigation/quick search coverage
- เพิ่ม Zod validation
- เพิ่ม AuditLog mapping สำหรับ `KnowledgeArticle`
- เพิ่ม preview และ status transitions
- เพิ่ม revalidate paths หลัง publish/update/archive

### Phase 3 - AI Draft Assistant

- เพิ่ม `lib/knowledge-ai.ts`
- เพิ่ม action generate draft
- เพิ่ม evidence fields
- เพิ่ม guardrails ใน prompt และ validator
- ยังไม่เปิด auto-publish

### Phase 4 - Evidence-Driven Backlog

- เชื่อม Product Search no-result / low-result clusters
- เสนอ topic backlog จาก query จริง
- ให้ผู้ดูแลเลือก topic แล้ว generate draft
- เพิ่ม measurement fields ภายหลัง เช่น source cluster id, published topic outcome

## Revalidation Requirements

เมื่อ publish/update/archive:

- `revalidatePath("/knowledge")`
- `revalidatePath("/knowledge/[slug]")` ของ slug เดิมและ slug ใหม่ถ้าเปลี่ยน slug
- `revalidatePath("/sitemap.xml")` ถ้าใช้ได้ใน Next version นี้; ถ้าไม่รองรับ ให้ revalidate route ที่เหมาะสมตาม local docs
- revalidate product/category pages เฉพาะถ้ามีการแก้ internal link relation ที่กระทบหน้าเหล่านั้น
- revalidate admin knowledge list/detail

ถ้าไม่แน่ใจ behavior ของ Next.js cache/revalidate ใน version นี้ ต้องอ่าน `node_modules/next/dist/docs/` ก่อนแก้ code

## Validation Checklist

หลัง implementation แต่ละ phase:

- `npx prisma validate`
- `npx prisma generate` ถ้า schema เปลี่ยน
- `npm run build`
- ตรวจว่า `/knowledge` แสดงเฉพาะ published article
- ตรวจว่า `/knowledge/[slug]` draft/archived return 404
- ตรวจ metadata canonical ของ article
- ตรวจ `ArticleJsonLd` ตรงกับ visible content
- ตรวจ sitemap ไม่มี draft/archived URLs
- ตรวจ product/category internal links ยังไม่หาย
- ตรวจ admin permissions ทั้ง page และ actions
- ตรวจ Quick Search command mode เห็นเมนู Knowledge ตาม permission
- ตรวจ AuditLog มี entity label/source route สำหรับ `KnowledgeArticle`
- ตรวจ Thai text ไม่ mojibake

## Risks

- Draft หลุด index ถ้า status filter พลาด
- Slug เปลี่ยนแล้ว canonical / sitemap / internal links ไม่ sync
- AI สร้าง claims เกินจริงเรื่อง OEM, fitment, stock, price
- Public page ช้าลงจาก DB query ที่กว้างเกินไป
- Admin UI หนักเกินจำเป็นถ้ารีบใส่ rich text editor
- ใช้ `ContentPost` เดิมแล้วทำให้ Facebook workflow พังหรือ confusing

## Guardrails For Future AI Agents

- ห้ามเริ่ม implement โดยแก้ `ContentPost` ให้รองรับ Knowledge เว้นแต่ผู้ใช้สั่งชัดเจนและยอมรับผลกระทบ
- ห้ามแตะ Facebook publish flow เพื่อทำ Knowledge CMS
- ห้ามเปลี่ยน URL `/knowledge/[slug]` โดยไม่มี redirect/canonical plan
- ห้ามให้ unpublished article เข้า sitemap หรือ OG image route
- ห้ามลบ `lib/knowledge-content.ts` จนกว่า migration/backfill และ public DB path ผ่าน build แล้ว
- ห้ามใช้ raw user LINE messages เป็น public article โดยไม่ sanitize
- ห้ามเพิ่ม DateTime field แบบไม่มี `@db.Timestamptz(3)`
- ห้ามเพิ่ม admin menu โดยไม่เพิ่ม permission และไม่ตรวจ Quick Search coverage
- ห้ามเพิ่ม admin route ใต้ protected โดยไม่มี `loading.tsx`
- ห้ามเพิ่ม visible storefront content ที่ทำให้ layout shift โดยไม่ตรวจ Core Web Vitals impact

## Open Questions

- จะใช้ category เป็น enum ถาวร หรือเก็บเป็น string เพื่อให้ผู้ดูแลเพิ่มหมวดเองได้
- จะให้ slug เปลี่ยนหลัง publish ได้หรือไม่ ถ้าได้ต้องมี redirect table หรือไม่
- ต้องมี approval queue แยกสำหรับ Knowledge หรือให้ผู้มี `knowledge.publish` publish จาก detail page ได้เลย
- ต้องการ preview public article ด้วย draft data ก่อน publish หรือ preview เฉพาะใน admin layout
- จะ migrate existing articles ด้วย seed script ครั้งเดียว หรือทำ admin import flow
- จะ update `public/llms.txt` อัตโนมัติจาก published Knowledge ได้หรือให้เป็น manual file ต่อไป
- จะเริ่ม evidence integration จาก Product Search no-result ก่อน หรือจาก manual admin notes ก่อน
