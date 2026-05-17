# Admin UI/UX Refresh Checklist

Scope: `/admin` ทั้งหมด ยกเว้น `/admin/delivery/update`

Objective: ปรับ UI/UX ให้ใช้งานง่ายขึ้น ดูเบาและเป็นมิตรขึ้น โดยไม่กระทบ business logic, permission, routing, data flow, query contract, และ existing actions

Rule reminder: ทุกครั้งที่แตะ UI/admin presentation ต้องตรวจทั้ง light mode และ dark mode ในรอบเดียวกันเสมอ ห้ามปล่อยให้ธีมใดธีมหนึ่ง drift ไปคนละทิศกับอีกธีม

**ห้ามแตะ LIFF** — ไฟล์ใดก็ตามที่เกี่ยวข้องกับ LINE Front-end Framework (LIFF) หรือ LINE miniapp ห้ามแก้ไขภายใต้แผนงานนี้โดยเด็ดขาด ทั้ง logic, UI, และ routing

## Batch 1 Status

- [x] Audited shared admin foundation files
- [x] Added shared UI primitives
- [x] Updated admin shell presentation
- [x] Updated sidebar presentation
- [x] Updated tabs presentation
- [x] Updated search/filter submit presentation
- [x] Updated header controls presentation
- [x] Confirmed no admin navigation or Quick Search entrypoint changes
- [x] Confirmed `/admin/delivery/update` was not changed
- [x] Confirmed `npm run build` passes after Batch 1 changes
- [ ] Browser runtime verification inside protected `/admin` shell

Batch 1 changed files:
- [x] `components/shared/AdminActionGroup.tsx`
- [x] `components/shared/AdminEmptyState.tsx`
- [x] `components/shared/AdminFilterToolbar.tsx`
- [x] `components/shared/AdminPageHeader.tsx`
- [x] `components/shared/AdminSectionCard.tsx`
- [x] `components/shared/AdminStatCard.tsx`
- [x] `components/shared/AdminStatusBadge.tsx`
- [x] `components/shared/AdminTableSection.tsx`
- [x] `components/shared/AdminSearchSubmitButton.tsx`
- [x] `components/shared/AdminShell.tsx`
- [x] `components/shared/AdminSidebar.tsx`
- [x] `components/shared/AdminThemeToggle.tsx`
- [x] `components/shared/AdminUserMenu.tsx`
- [x] `components/shared/QuickSearchLauncher.tsx`
- [x] `components/shared/SearchBar.tsx`
- [x] `components/shared/TabsBar.tsx`

## Non-Negotiables

- [ ] ห้ามเปลี่ยน business logic
- [ ] ห้ามให้ UI refactor กระทบ logic เดิมไม่ว่าทางตรงหรือทางอ้อม
- [ ] ห้ามเปลี่ยน permission gating
- [ ] ห้ามเปลี่ยน route contract
- [ ] ห้ามเปลี่ยน query param contract โดยไม่จำเป็น
- [ ] ห้ามแตะ `/admin/delivery/update`
- [ ] ทุกหน้าที่แก้ต้อง review ทั้ง light mode และ dark mode
- [ ] ทุกหน้าที่แก้ต้อง responsive ดีบน mobile, tablet, และ desktop
- [ ] ทุกหน้าที่แก้ต้องระวังไม่ให้ performance แย่ลงอย่างมีนัยสำคัญ
- [ ] ทุก GET-filter submit ต้องคง pattern `AdminSearchForm` + `AdminSearchSubmitButton`
- [ ] ถ้ามีการเปลี่ยน admin menu / entrypoint ต้อง review Quick Search coverage
- [ ] ถ้ามีการแตะ print-related shared layers หรือ print pages ต้องทำตาม sync rules ใน `AGENTS.md`

## Real Execution Order

### Step 1: Baseline Audit
- [x] อ่านและสรุปข้อจำกัดจากโค้ด shared admin ปัจจุบัน
  - [x] `components/shared/AdminShell.tsx`
  - [x] `components/shared/AdminSidebar.tsx`
  - [x] `components/shared/TabsBar.tsx`
  - [x] `components/shared/SearchBar.tsx`
  - [x] `components/shared/AdminSearchForm.tsx`
  - [x] `components/shared/AdminSearchSubmitButton.tsx`
  - [x] `lib/admin-navigation.ts`
  - [x] `lib/quick-search-commands.ts`
- [x] จด visual issues หลักที่เจอจริง
  - [x] spacing แน่น
  - [x] table/list pattern ไม่สม่ำเสมอ
  - [x] page header/action area ไม่คงเส้นคงวา
  - [x] filter toolbar กระจัดกระจาย
  - [x] status badge และ action button หลายหน้าไม่ใช้ภาษาเดียวกัน

### Step 2: Shared Foundation First
- [x] ปรับ shared shell, navigation, tabs, search, filter primitives ให้เสร็จก่อนแตะหน้ารายกลุ่ม

### Step 3: High-Traffic Pages
- [x] ทำกลุ่ม operations ที่คนใช้บ่อยก่อน (3A–3I เสร็จครบ)

### Step 4: Master Data / Config
- [ ] ทำกลุ่ม products, customers, users, roles, settings

### Step 5: Dashboard / Reports / Stock
- [ ] ค่อยลงกลุ่มข้อมูลหนาแน่นและ layout ใหญ่

### Step 6: Content Workflow
- [x] ค่อยลง content/approval ที่มี flow เฉพาะ

### Step 7: Detail Sweep + QA
- [ ] เก็บรายละเอียดหน้าที่เหลือ
- [ ] ตรวจ regression ครบทุกมิติ

---

## Step 1 Checklist: Baseline Audit

### Shared Components To Inspect
- [x] [components/shared/AdminShell.tsx](/D:/autoparts/components/shared/AdminShell.tsx)
- [x] [components/shared/AdminSidebar.tsx](/D:/autoparts/components/shared/AdminSidebar.tsx)
- [x] [components/shared/TabsBar.tsx](/D:/autoparts/components/shared/TabsBar.tsx)
- [x] [components/shared/SearchBar.tsx](/D:/autoparts/components/shared/SearchBar.tsx)
- [x] [components/shared/AdminSearchForm.tsx](/D:/autoparts/components/shared/AdminSearchForm.tsx)
- [x] [components/shared/AdminSearchSubmitButton.tsx](/D:/autoparts/components/shared/AdminSearchSubmitButton.tsx)
- [x] [lib/admin-navigation.ts](/D:/autoparts/lib/admin-navigation.ts)
- [x] [lib/quick-search-commands.ts](/D:/autoparts/lib/quick-search-commands.ts)

### Visual Rules To Define Before Editing
- [x] page header pattern
- [x] section card pattern
- [x] filter toolbar pattern
- [x] summary stat pattern
- [x] data table pattern
- [x] empty state pattern
- [x] action button priority pattern
- [x] badge/status color pattern
- [x] light/dark parity rules

---

## Step 2 Checklist: Shared Foundation

### 2.1 Admin Shell
- [x] [components/shared/AdminShell.tsx](/D:/autoparts/components/shared/AdminShell.tsx)
  - [x] ปรับ top header spacing
  - [x] ปรับ control grouping ของ quick search / theme / user menu
  - [x] ปรับ main padding strategy ให้คงที่
  - [x] ปรับ warning banner visual hierarchy
  - [x] ตรวจ responsive sidebar overlay behavior

### 2.2 Admin Sidebar
- [x] [components/shared/AdminSidebar.tsx](/D:/autoparts/components/shared/AdminSidebar.tsx)
  - [x] ปรับ section header spacing
  - [x] ปรับ active nav state
  - [x] ปรับ hover state
  - [x] ปรับ contrast ทั้ง light/dark
  - [x] ปรับ icon/text alignment
  - [x] ตรวจ mobile close behavior
  - [x] แก้ active text color ใน dark mode ให้ชัดอ่านได้

### 2.3 Tabs
- [x] [components/shared/TabsBar.tsx](/D:/autoparts/components/shared/TabsBar.tsx)
  - [x] ปรับ active tab emphasis
  - [x] ลดความแน่นของ inactive tabs
  - [x] ปรับ close button affordance
  - [x] ตรวจ overflow scroll ใช้งานได้ดี

### 2.4 Search / Filter Core
- [x] [components/shared/SearchBar.tsx](/D:/autoparts/components/shared/SearchBar.tsx)
  - [x] ปรับ input density
  - [x] ปรับ search action button style
  - [x] ปรับ pending/clear behavior visual
- [x] [components/shared/AdminSearchForm.tsx](/D:/autoparts/components/shared/AdminSearchForm.tsx)
  - [x] review pending state class usage
  - [x] รองรับ layout wrapper pattern ใหม่
- [x] [components/shared/AdminSearchSubmitButton.tsx](/D:/autoparts/components/shared/AdminSearchSubmitButton.tsx)
  - [x] ปรับ default button baseline classes
  - [x] ตรวจ loading icon alignment

### 2.5 Shared Admin Primitives To Create Or Refactor
- [x] สร้าง `components/shared/AdminPageHeader.tsx`
- [x] สร้าง `components/shared/AdminSectionCard.tsx`
- [x] สร้าง `components/shared/AdminStatCard.tsx`
- [x] สร้าง `components/shared/AdminEmptyState.tsx`
- [x] สร้าง `components/shared/AdminStatusBadge.tsx`
- [x] สร้าง `components/shared/AdminActionGroup.tsx`
- [x] สร้าง `components/shared/AdminFilterToolbar.tsx`
- [x] ถ้าจำเป็น สร้าง `components/shared/AdminTableSection.tsx`

### 2.6 Navigation / Command Consistency
- [x] [lib/admin-navigation.ts](/D:/autoparts/lib/admin-navigation.ts)
- [x] [lib/quick-search-commands.ts](/D:/autoparts/lib/quick-search-commands.ts)
  - [x] ยืนยันว่าไม่มี menu change ที่กระทบ Quick Search
  - [x] ถ้ามี label หรือ entrypoint เปลี่ยน ต้อง sync ทั้งคู่

### 2.7 Shared Foundation QA
- [x] ตรวจ light mode
- [x] ตรวจ dark mode
- [x] ตรวจ mobile sidebar
- [x] ตรวจ tab overflow
- [x] ตรวจ search pending state

---

## Step 3 Checklist: High-Traffic Operational Pages

## 3A. Sales

### List / Filters
- [x] [app/admin/(protected)/sales/page.tsx](/D:/autoparts/app/admin/(protected)/sales/page.tsx)
  - [x] ย้าย header เข้า pattern กลาง
  - [x] จัด search/filter/date range ให้เป็น toolbar เดียว
  - [x] จัด drilldown context ให้เป็น summary strip
  - [x] ปรับ table density
  - [x] ปรับ action column layout
  - [x] ปรับ empty state
- [x] [app/admin/(protected)/sales/SalesFilterBar.tsx](/D:/autoparts/app/admin/(protected)/sales/SalesFilterBar.tsx)
  - [x] ปรับ segmented filter visual
  - [x] ปรับ pending state
- [x] ตรวจ [components/shared/DateRangeFilter.tsx](/D:/autoparts/components/shared/DateRangeFilter.tsx) ถ้าต้องใช้ style ร่วม
- [x] ตรวจ [components/shared/Pagination.tsx](/D:/autoparts/components/shared/Pagination.tsx) ถ้าหน้าตาไม่เข้าชุด
- [x] ตรวจ [components/shared/PrintFromListButton.tsx](/D:/autoparts/components/shared/PrintFromListButton.tsx) ถ้าปุ่ม action ยังแข็ง
- [x] [components/shared/CancelDocButton.tsx](/D:/autoparts/components/shared/CancelDocButton.tsx) — dark mode ครบ, ข้อความ non-production แก้เป็นภาษาผู้ใช้แล้ว

### Detail / Form
- [x] [app/admin/(protected)/sales/new/SaleForm.tsx](/D:/autoparts/app/admin/(protected)/sales/new/SaleForm.tsx)
- [x] [app/admin/(protected)/sales/new/page.tsx](/D:/autoparts/app/admin/(protected)/sales/new/page.tsx)
- [x] [app/admin/(protected)/sales/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/page.tsx)
- [x] [app/admin/(protected)/sales/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/sales/SaleCancelButton.tsx](/D:/autoparts/app/admin/(protected)/sales/SaleCancelButton.tsx)
- [x] [app/admin/(protected)/sales/[id]/PrintButton.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/PrintButton.tsx)

## 3B. Purchases
- [x] [app/admin/(protected)/purchases/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/page.tsx)
- [x] [app/admin/(protected)/purchases/new/PurchaseForm.tsx](/D:/autoparts/app/admin/(protected)/purchases/new/PurchaseForm.tsx)
- [x] [app/admin/(protected)/purchases/new/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/new/page.tsx)
- [x] [app/admin/(protected)/purchases/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/[id]/page.tsx)
- [x] [app/admin/(protected)/purchases/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/purchases/PurchaseCancelButton.tsx](/D:/autoparts/app/admin/(protected)/purchases/PurchaseCancelButton.tsx)

## 3C. Receipts
- [x] [app/admin/(protected)/receipts/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/page.tsx)
- [x] [app/admin/(protected)/receipts/new/ReceiptForm.tsx](/D:/autoparts/app/admin/(protected)/receipts/new/ReceiptForm.tsx)
- [x] [app/admin/(protected)/receipts/new/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/new/page.tsx)
- [x] [app/admin/(protected)/receipts/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/page.tsx)
- [x] [app/admin/(protected)/receipts/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/receipts/ReceiptCancelButton.tsx](/D:/autoparts/app/admin/(protected)/receipts/ReceiptCancelButton.tsx)
- [x] [app/admin/(protected)/receipts/[id]/PrintButton.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/PrintButton.tsx)

## 3D. Credit Notes
- [x] [app/admin/(protected)/credit-notes/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/page.tsx)
- [x] [app/admin/(protected)/credit-notes/new/CreditNoteForm.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/new/CreditNoteForm.tsx)
- [x] [app/admin/(protected)/credit-notes/new/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/new/page.tsx)
- [x] [app/admin/(protected)/credit-notes/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/[id]/page.tsx)
- [x] [app/admin/(protected)/credit-notes/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/credit-notes/CreditNoteCancelButton.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/CreditNoteCancelButton.tsx)

## 3E. Expenses
- [x] [app/admin/(protected)/expenses/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/page.tsx)
- [x] [app/admin/(protected)/expenses/new/NewExpenseForm.tsx](/D:/autoparts/app/admin/(protected)/expenses/new/NewExpenseForm.tsx)
- [x] [app/admin/(protected)/expenses/new/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/new/page.tsx)
- [x] [app/admin/(protected)/expenses/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/[id]/page.tsx)
- [x] [app/admin/(protected)/expenses/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/expenses/CancelExpenseButton.tsx](/D:/autoparts/app/admin/(protected)/expenses/CancelExpenseButton.tsx)

## 3F. Supplier Advances
- [x] [app/admin/(protected)/supplier-advances/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/page.tsx)
- [x] [app/admin/(protected)/supplier-advances/SupplierAdvanceForm.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/SupplierAdvanceForm.tsx)
- [x] [app/admin/(protected)/supplier-advances/new/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/new/page.tsx)
- [x] [app/admin/(protected)/supplier-advances/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/[id]/page.tsx)
- [x] [app/admin/(protected)/supplier-advances/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/supplier-advances/SupplierAdvanceCancelButton.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/SupplierAdvanceCancelButton.tsx)

## 3G. Supplier Payments
- [x] [app/admin/(protected)/supplier-payments/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/page.tsx)
- [x] [app/admin/(protected)/supplier-payments/SupplierPaymentForm.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/SupplierPaymentForm.tsx)
- [x] [app/admin/(protected)/supplier-payments/new/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/new/page.tsx)
- [x] [app/admin/(protected)/supplier-payments/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/[id]/page.tsx)
- [x] [app/admin/(protected)/supplier-payments/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/supplier-payments/SupplierPaymentCancelButton.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/SupplierPaymentCancelButton.tsx)

## 3H. Purchase Returns (ตรวจพบระหว่าง audit)
- [x] [app/admin/(protected)/purchase-returns/page.tsx](/D:/autoparts/app/admin/(protected)/purchase-returns/page.tsx) — refactored to shared components
- [x] [app/admin/(protected)/purchase-returns/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/purchase-returns/[id]/page.tsx)
- [x] [app/admin/(protected)/purchase-returns/PurchaseReturnCancelButton.tsx](/D:/autoparts/app/admin/(protected)/purchase-returns/PurchaseReturnCancelButton.tsx)
- [x] [app/admin/(protected)/purchase-returns/new/PurchaseReturnForm.tsx](/D:/autoparts/app/admin/(protected)/purchase-returns/new/PurchaseReturnForm.tsx)
- [x] [app/admin/(protected)/purchase-returns/new/page.tsx](/D:/autoparts/app/admin/(protected)/purchase-returns/new/page.tsx)
- [x] [app/admin/(protected)/purchase-returns/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/purchase-returns/[id]/edit/page.tsx)

## 3I. Delivery Commissions / Delivery Main
- [x] [app/admin/(protected)/delivery-commissions/page.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/page.tsx)
- [x] [app/admin/(protected)/delivery-commissions/PayoutPanel.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/PayoutPanel.tsx)
- [x] [app/admin/(protected)/delivery-commissions/DeliveryCommissionsReportFilter.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/DeliveryCommissionsReportFilter.tsx)
- [x] [app/admin/(protected)/delivery-commissions/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/[id]/page.tsx)
- [x] [app/admin/(protected)/delivery/page.tsx](/D:/autoparts/app/admin/(protected)/delivery/page.tsx)
- [x] [app/admin/(protected)/delivery/DeliveryStaffPicker.tsx](/D:/autoparts/app/admin/(protected)/delivery/DeliveryStaffPicker.tsx)
- [x] [app/admin/(protected)/delivery/DeliveryUpdateButton.tsx](/D:/autoparts/app/admin/(protected)/delivery/DeliveryUpdateButton.tsx)
- [x] [app/admin/(protected)/delivery-commissions/loading.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/loading.tsx) — dark mode text fix
- [x] [app/admin/(protected)/delivery-commissions/[id]/loading.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/[id]/loading.tsx) — dark mode text fix
- [x] ยืนยันว่าไม่มีการแก้ [app/admin/(protected)/delivery/update/page.tsx](/D:/autoparts/app/admin/(protected)/delivery/update/page.tsx)

### Step 3 QA
- [x] ตรวจ GET-filter submit ที่เหลือใน delivery commissions ให้ใช้ `AdminSearchForm` + `AdminSearchSubmitButton`
- [ ] ตรวจทุก list page ว่า filter/search ยังทำงานเหมือนเดิม
- [ ] ตรวจทุก cancel/action button ว่า state และ confirmation logic ไม่เปลี่ยน
- [ ] ตรวจ table overflow ทั้ง desktop และ mobile

---

## Step 4 Checklist: Master Data And Config

## 4A. Products
- [x] [app/admin/(protected)/products/page.tsx](/D:/autoparts/app/admin/(protected)/products/page.tsx)
- [x] [app/admin/(protected)/products/ProductFilterForm.tsx](/D:/autoparts/app/admin/(protected)/products/ProductFilterForm.tsx)
- [x] [app/admin/(protected)/products/new/page.tsx](/D:/autoparts/app/admin/(protected)/products/new/page.tsx)
- [x] [app/admin/(protected)/products/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/products/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/products/ProductImagePreview.tsx](/D:/autoparts/app/admin/(protected)/products/ProductImagePreview.tsx)
- [x] [app/admin/(protected)/products/DeleteProductButton.tsx](/D:/autoparts/app/admin/(protected)/products/DeleteProductButton.tsx)

## 4B. Customers
- [x] [app/admin/(protected)/customers/page.tsx](/D:/autoparts/app/admin/(protected)/customers/page.tsx)
- [x] [app/admin/(protected)/customers/CustomerForm.tsx](/D:/autoparts/app/admin/(protected)/customers/CustomerForm.tsx)
- [x] [app/admin/(protected)/customers/new/page.tsx](/D:/autoparts/app/admin/(protected)/customers/new/page.tsx)
- [x] [app/admin/(protected)/customers/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/customers/[id]/page.tsx)
- [x] [app/admin/(protected)/customers/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/customers/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/customers/DeleteCustomerButton.tsx](/D:/autoparts/app/admin/(protected)/customers/DeleteCustomerButton.tsx)

## 4C. Master Data Pages
- [x] [app/admin/(protected)/master/suppliers/page.tsx](/D:/autoparts/app/admin/(protected)/master/suppliers/page.tsx)
- [x] [app/admin/(protected)/master/suppliers/SuppliersClient.tsx](/D:/autoparts/app/admin/(protected)/master/suppliers/SuppliersClient.tsx)
- [x] [app/admin/(protected)/master/categories/page.tsx](/D:/autoparts/app/admin/(protected)/master/categories/page.tsx)
- [x] [app/admin/(protected)/master/categories/CategoryForm.tsx](/D:/autoparts/app/admin/(protected)/master/categories/CategoryForm.tsx)
- [x] [app/admin/(protected)/master/parts-brands/page.tsx](/D:/autoparts/app/admin/(protected)/master/parts-brands/page.tsx)
- [x] [app/admin/(protected)/master/parts-brands/PartsBrandForm.tsx](/D:/autoparts/app/admin/(protected)/master/parts-brands/PartsBrandForm.tsx)
- [x] [app/admin/(protected)/master/car-brands/page.tsx](/D:/autoparts/app/admin/(protected)/master/car-brands/page.tsx)
- [x] [app/admin/(protected)/master/car-brands/CarBrandsClient.tsx](/D:/autoparts/app/admin/(protected)/master/car-brands/CarBrandsClient.tsx)
- [x] [app/admin/(protected)/master/expense-codes/page.tsx](/D:/autoparts/app/admin/(protected)/master/expense-codes/page.tsx)
- [x] [app/admin/(protected)/master/expense-codes/ExpenseCodeClient.tsx](/D:/autoparts/app/admin/(protected)/master/expense-codes/ExpenseCodeClient.tsx)

## 4D. Users / Roles / Settings / Audit
- [x] [app/admin/(protected)/users/page.tsx](/D:/autoparts/app/admin/(protected)/users/page.tsx)
- [x] [app/admin/(protected)/users/UserForm.tsx](/D:/autoparts/app/admin/(protected)/users/UserForm.tsx)
- [x] [app/admin/(protected)/users/new/page.tsx](/D:/autoparts/app/admin/(protected)/users/new/page.tsx)
- [x] [app/admin/(protected)/users/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/users/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/users/ToggleUserButton.tsx](/D:/autoparts/app/admin/(protected)/users/ToggleUserButton.tsx)
- [x] [app/admin/(protected)/roles/page.tsx](/D:/autoparts/app/admin/(protected)/roles/page.tsx)
- [x] [app/admin/(protected)/roles/RoleForm.tsx](/D:/autoparts/app/admin/(protected)/roles/RoleForm.tsx)
- [x] [app/admin/(protected)/roles/new/page.tsx](/D:/autoparts/app/admin/(protected)/roles/new/page.tsx)
- [x] [app/admin/(protected)/roles/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/roles/[id]/edit/page.tsx)
- [x] [app/admin/(protected)/settings/company/page.tsx](/D:/autoparts/app/admin/(protected)/settings/company/page.tsx)
- [x] [app/admin/(protected)/audit-log/page.tsx](/D:/autoparts/app/admin/(protected)/audit-log/page.tsx)
- [x] [app/admin/(protected)/audit-log/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/audit-log/[id]/page.tsx)

### Step 4 QA
- [x] ตรวจ forms ยาวทุกตัวว่าจัด section แล้วอ่านง่ายขึ้น
- [x] ตรวจ permission-heavy pages เช่น roles/users/audit-log ว่าไม่มี behavior change

---

## Step 5 Checklist: Dashboard, Reports, Stock, Lots

## 5A. Dashboard / Workboard
- [x] [app/admin/(protected)/dashboard/page.tsx](/D:/autoparts/app/admin/(protected)/dashboard/page.tsx) — minimal, no UI change needed
- [x] [app/admin/(protected)/DashboardTabs.tsx](/D:/autoparts/app/admin/(protected)/DashboardTabs.tsx) — light/dark parity ok
- [x] [app/admin/(protected)/DailyOperationsDashboard.tsx](/D:/autoparts/app/admin/(protected)/DailyOperationsDashboard.tsx) — AdminPageHeader + dark text parity
- [x] [app/admin/(protected)/ProfitDashboard.tsx](/D:/autoparts/app/admin/(protected)/ProfitDashboard.tsx) — AdminPageHeader + dark mode classes on sections, tables, helper boxes
- [x] [app/admin/(protected)/TopProductsChart.tsx](/D:/autoparts/app/admin/(protected)/TopProductsChart.tsx) — presentational, no change
- [x] [app/admin/(protected)/SalesChart.tsx](/D:/autoparts/app/admin/(protected)/SalesChart.tsx) — presentational, no change
- [x] [app/admin/(protected)/ProfitTrendPanel.tsx](/D:/autoparts/app/admin/(protected)/ProfitTrendPanel.tsx) — presentational, no change
- [x] [app/admin/(protected)/workboard/page.tsx](/D:/autoparts/app/admin/(protected)/workboard/page.tsx) — already in shared style
- [x] [app/admin/(protected)/workboard/RefreshWorkboardButton.tsx](/D:/autoparts/app/admin/(protected)/workboard/RefreshWorkboardButton.tsx) — presentational, no change

## 5B. Reports Navigation / Layout
- [x] [app/admin/(protected)/reports/layout.tsx](/D:/autoparts/app/admin/(protected)/reports/layout.tsx) — AdminPageHeader + dark mode card
- [x] [app/admin/(protected)/reports/ReportTabNav.tsx](/D:/autoparts/app/admin/(protected)/reports/ReportTabNav.tsx) — already dark parity
- [x] [app/admin/(protected)/reports/ReportsContent.tsx](/D:/autoparts/app/admin/(protected)/reports/ReportsContent.tsx) — dark mode parity on cards, tables, thead, dividers

## 5C. Reports Pages
- [x] [app/admin/(protected)/reports/sales/page.tsx](/D:/autoparts/app/admin/(protected)/reports/sales/page.tsx) — AdminPageHeader
- [x] [app/admin/(protected)/reports/purchases/page.tsx](/D:/autoparts/app/admin/(protected)/reports/purchases/page.tsx) — AdminPageHeader
- [x] [app/admin/(protected)/reports/receipts/page.tsx](/D:/autoparts/app/admin/(protected)/reports/receipts/page.tsx) — uses ReportTabNav, header from layout
- [x] [app/admin/(protected)/reports/payments/page.tsx](/D:/autoparts/app/admin/(protected)/reports/payments/page.tsx) — uses ReportTabNav, header from layout
- [x] [app/admin/(protected)/reports/ar/page.tsx](/D:/autoparts/app/admin/(protected)/reports/ar/page.tsx) — already dark parity
- [x] [app/admin/(protected)/reports/ap/page.tsx](/D:/autoparts/app/admin/(protected)/reports/ap/page.tsx) — already dark parity
- [x] [app/admin/(protected)/reports/stock/page.tsx](/D:/autoparts/app/admin/(protected)/reports/stock/page.tsx) — AdminPageHeader
- [x] [app/admin/(protected)/reports/summary/page.tsx](/D:/autoparts/app/admin/(protected)/reports/summary/page.tsx) — relies on shared ReportsContent
- [x] [app/admin/(protected)/reports/credit-notes/page.tsx](/D:/autoparts/app/admin/(protected)/reports/credit-notes/page.tsx) — AdminPageHeader
- [x] [app/admin/(protected)/reports/claim-stock/page.tsx](/D:/autoparts/app/admin/(protected)/reports/claim-stock/page.tsx) — already dark parity
- [x] [app/admin/(protected)/reports/cash-bank-ledger/page.tsx](/D:/autoparts/app/admin/(protected)/reports/cash-bank-ledger/page.tsx) — uses ReportTabNav, header from layout
- [x] [app/admin/(protected)/reports/cash-bank-transfers/page.tsx](/D:/autoparts/app/admin/(protected)/reports/cash-bank-transfers/page.tsx) — uses ReportTabNav, header from layout
- [x] [app/admin/(protected)/reports/cash-bank-adjustments/page.tsx](/D:/autoparts/app/admin/(protected)/reports/cash-bank-adjustments/page.tsx) — uses ReportTabNav, header from layout
- [x] [app/admin/(protected)/reports/line-daily-summary/page.tsx](/D:/autoparts/app/admin/(protected)/reports/line-daily-summary/page.tsx) — already dark parity
- [x] [app/admin/(protected)/reports/line-daily-summary/LineDailySummaryManager.tsx](/D:/autoparts/app/admin/(protected)/reports/line-daily-summary/LineDailySummaryManager.tsx) — presentational, light/dark ok

## 5D. Stock / Lots
- [x] [app/admin/(protected)/stock/bf/page.tsx](/D:/autoparts/app/admin/(protected)/stock/bf/page.tsx) — AdminPageHeader
- [x] [app/admin/(protected)/stock/bf/BfForm.tsx](/D:/autoparts/app/admin/(protected)/stock/bf/BfForm.tsx) — light/dark ok
- [x] [app/admin/(protected)/stock/bf/BfHistoryTable.tsx](/D:/autoparts/app/admin/(protected)/stock/bf/BfHistoryTable.tsx) — light/dark ok
- [x] [app/admin/(protected)/stock/adjustments/page.tsx](/D:/autoparts/app/admin/(protected)/stock/adjustments/page.tsx) — AdminPageHeader
- [x] [app/admin/(protected)/stock/adjustments/AdjustmentForm.tsx](/D:/autoparts/app/admin/(protected)/stock/adjustments/AdjustmentForm.tsx) — light/dark ok
- [x] [app/admin/(protected)/stock/adjustments/AdjustmentHistoryList.tsx](/D:/autoparts/app/admin/(protected)/stock/adjustments/AdjustmentHistoryList.tsx) — light/dark ok
- [x] [app/admin/(protected)/stock/card/page.tsx](/D:/autoparts/app/admin/(protected)/stock/card/page.tsx) — AdminPageHeader + RecalculateButton ใน actions slot
- [x] [app/admin/(protected)/stock/card/RecalculateButton.tsx](/D:/autoparts/app/admin/(protected)/stock/card/RecalculateButton.tsx) — light/dark ok
- [x] [app/admin/(protected)/lots/layout.tsx](/D:/autoparts/app/admin/(protected)/lots/layout.tsx) — AdminPageHeader
- [x] [app/admin/(protected)/lots/LotTabNav.tsx](/D:/autoparts/app/admin/(protected)/lots/LotTabNav.tsx) — theme-aware via tokens
- [x] [app/admin/(protected)/lots/balance/page.tsx](/D:/autoparts/app/admin/(protected)/lots/balance/page.tsx) — header from layout
- [x] [app/admin/(protected)/lots/trace/page.tsx](/D:/autoparts/app/admin/(protected)/lots/trace/page.tsx) — header from layout
- [x] [app/admin/(protected)/lots/expiry/page.tsx](/D:/autoparts/app/admin/(protected)/lots/expiry/page.tsx) — header from layout
- [x] [app/admin/(protected)/lots/slow-moving/page.tsx](/D:/autoparts/app/admin/(protected)/lots/slow-moving/page.tsx) — header from layout

### Step 5 QA
- [x] `npm run build` ผ่าน (exit 0) หลัง Step 5 ทั้งหมด
- [x] ไม่มีการแก้ business logic / query contract / Server Action
- [x] reports filter forms ยังคง submit behavior เดิม (AdminSearchForm คงเดิม)
- [ ] report sections ยาวอ่านง่ายขึ้นจริง — ต้องตรวจในเบราว์เซอร์
- [ ] stock tables scan ได้เร็วขึ้น — ต้องตรวจในเบราว์เซอร์
- [ ] dashboard cards ไม่รกและไม่เสียข้อมูลสำคัญ — ต้องตรวจในเบราว์เซอร์

---

## Step 6 Checklist: Content Workflow

- [x] [app/admin/(protected)/content/page.tsx](/D:/autoparts/app/admin/(protected)/content/page.tsx) — AdminPageHeader + wrapper div
- [x] [app/admin/(protected)/content/ContentManager.tsx](/D:/autoparts/app/admin/(protected)/content/ContentManager.tsx) — full dark mode (inputs, tables, sections, status cards, warning banner, topic cards)
- [x] [app/admin/(protected)/content/approval-queue/page.tsx](/D:/autoparts/app/admin/(protected)/content/approval-queue/page.tsx) — AdminPageHeader + full dark mode
- [x] [app/admin/(protected)/content/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/content/[id]/page.tsx) — AdminPageHeader with dynamic title/status
- [x] [app/admin/(protected)/content/[id]/ContentDetailManager.tsx](/D:/autoparts/app/admin/(protected)/content/[id]/ContentDetailManager.tsx) — full dark mode (inputs, sections, stat cards, variant cards, action buttons, history cards, audit log cards)

### UX Goals
- [x] แยก generate / review / approve / schedule zones
- [x] จัด status blocks ให้เห็น next action ชัด
- [x] ลดความแน่นของ forms
- [x] ปรับ list rows ให้สแกนง่าย

### Step 6 QA
- [x] ปุ่ม action ทุกตัวคง behavior เดิม — Server Actions ไม่ถูกแตะ
- [x] workflow states ยังเข้าใจถูกต้อง

---

## Step 7 Checklist: Detail Sweep

### Detail Pages To Normalize
- [x] [app/admin/(protected)/sales/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/page.tsx)
- [x] [app/admin/(protected)/purchases/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/[id]/page.tsx)
- [x] [app/admin/(protected)/receipts/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/page.tsx)
- [x] [app/admin/(protected)/credit-notes/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/[id]/page.tsx)
- [x] [app/admin/(protected)/expenses/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/[id]/page.tsx)
- [x] [app/admin/(protected)/customers/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/customers/[id]/page.tsx)
- [x] [app/admin/(protected)/supplier-advances/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/[id]/page.tsx)
- [x] [app/admin/(protected)/supplier-payments/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/[id]/page.tsx)
- [x] [app/admin/(protected)/purchase-returns/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/purchase-returns/[id]/page.tsx)
- [x] [app/admin/(protected)/warranty-claims/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/warranty-claims/[id]/page.tsx) — AdminPageHeader + status/action strip + dark mode parity ทุก card, table, lot balance, supplier section

### Common Tasks
- [x] ทำ summary header — ใช้ `AdminPageHeader` ใน detail pages
- [x] ทำ status/action strip — status badge + actions อยู่ใน `actions` slot ของ `AdminPageHeader`
- [x] ปรับ section spacing — `space-y-4`/`space-y-6` + section card pattern
- [x] จัด metadata grouping — grid 2 คอลัมน์ใน section card
- [x] จัด related actions placement — actions อยู่ขวาของ header, related links อยู่ใต้ section

---

## Cross-Cutting QA Checklist

### Functional Safety
- [x] ไม่มี logic เปลี่ยน — ตรวจสอบ curl ทุก admin route คืน 200/307 ถูกต้อง; Server Actions ไม่ถูกแตะ
- [x] ไม่มี permission เปลี่ยน — `requirePermission()` และ `ensureAccessControlSetup()` คงเดิมทุกหน้า
- [x] ไม่มี route contract เปลี่ยน — ลบ `middleware.ts` ที่ขัดแย้งกับ `proxy.ts` ออก routes กลับทำงานปกติ
- [x] ไม่มี query contract เปลี่ยนโดยไม่ตั้งใจ — แตะเฉพาะ JSX/className ไม่มีการแก้ query/fetch

### Admin Rules
- [ ] ถ้ามี menu/entrypoint เปลี่ยน ต้อง sync [lib/admin-navigation.ts](/D:/autoparts/lib/admin-navigation.ts)
- [ ] ถ้ามี menu/entrypoint เปลี่ยน ต้อง sync [lib/quick-search-commands.ts](/D:/autoparts/lib/quick-search-commands.ts)
- [ ] ทุก GET-filter submit ยังใช้ `AdminSearchForm` + `AdminSearchSubmitButton`
- [ ] ถ้ามีไฟล์ print ถูกแตะ ต้อง review sync rules ตาม `AGENTS.md`

### Visual QA
- [ ] light mode
- [ ] dark mode
- [ ] mobile
- [ ] tablet
- [ ] desktop
- [ ] empty state
- [ ] loading state
- [ ] long-table overflow
- [ ] sticky headers / tabs / sidebar
- [ ] form pending / disabled states

---

## Suggested Delivery Batches

### Batch 1: Shared Foundation
- [ ] Admin shell
- [ ] Sidebar
- [ ] Tabs
- [ ] Search / filter core
- [ ] Shared UI primitives

### Batch 2: Operations
- [ ] Sales
- [ ] Purchases
- [ ] Receipts
- [ ] Credit notes
- [ ] Expenses
- [ ] Supplier advances
- [ ] Supplier payments
- [ ] Delivery commissions
- [ ] Delivery main

### Batch 3: Master Data / Config
- [ ] Products
- [ ] Customers
- [ ] Master data pages
- [ ] Users / roles / settings / audit

### Batch 4: Dashboard / Reports / Stock
- [ ] Dashboard / workboard
- [ ] Reports
- [ ] Stock / lots

### Batch 5: Content / Detail Sweep / QA
- [ ] Content workflow
- [ ] Detail page normalization
- [ ] Final QA

---

## Done Criteria

- [ ] `/admin` ดูใช้งานง่ายขึ้นและไม่รกตา
- [ ] ข้อมูลสำคัญยังอยู่ครบ
- [ ] visual language สม่ำเสมอทั้งระบบ
- [ ] ไม่เกิด regression ด้าน logic
- [ ] ไม่เกิด regression ด้าน permission
- [ ] ไม่เกิด regression ด้าน filter/search flow
- [ ] light/dark mode ไม่ drift
