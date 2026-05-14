# Admin UI/UX Refresh Checklist

Scope: `/admin` ทั้งหมด ยกเว้น `/admin/delivery/update`

Objective: ปรับ UI/UX ให้ใช้งานง่ายขึ้น ดูเบาและเป็นมิตรขึ้น โดยไม่กระทบ business logic, permission, routing, data flow, query contract, และ existing actions

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
- [ ] อ่านและสรุปข้อจำกัดจากโค้ด shared admin ปัจจุบัน
  - [ ] `components/shared/AdminShell.tsx`
  - [ ] `components/shared/AdminSidebar.tsx`
  - [ ] `components/shared/TabsBar.tsx`
  - [ ] `components/shared/SearchBar.tsx`
  - [ ] `components/shared/AdminSearchForm.tsx`
  - [ ] `components/shared/AdminSearchSubmitButton.tsx`
  - [ ] `lib/admin-navigation.ts`
  - [ ] `lib/quick-search-commands.ts`
- [ ] จด visual issues หลักที่เจอจริง
  - [ ] spacing แน่น
  - [ ] table/list pattern ไม่สม่ำเสมอ
  - [ ] page header/action area ไม่คงเส้นคงวา
  - [ ] filter toolbar กระจัดกระจาย
  - [ ] status badge และ action button หลายหน้าไม่ใช้ภาษาเดียวกัน

### Step 2: Shared Foundation First
- [ ] ปรับ shared shell, navigation, tabs, search, filter primitives ให้เสร็จก่อนแตะหน้ารายกลุ่ม

### Step 3: High-Traffic Pages
- [ ] ทำกลุ่ม operations ที่คนใช้บ่อยก่อน

### Step 4: Master Data / Config
- [ ] ทำกลุ่ม products, customers, users, roles, settings

### Step 5: Dashboard / Reports / Stock
- [ ] ค่อยลงกลุ่มข้อมูลหนาแน่นและ layout ใหญ่

### Step 6: Content Workflow
- [ ] ค่อยลง content/approval ที่มี flow เฉพาะ

### Step 7: Detail Sweep + QA
- [ ] เก็บรายละเอียดหน้าที่เหลือ
- [ ] ตรวจ regression ครบทุกมิติ

---

## Step 1 Checklist: Baseline Audit

### Shared Components To Inspect
- [ ] [components/shared/AdminShell.tsx](/D:/autoparts/components/shared/AdminShell.tsx)
- [ ] [components/shared/AdminSidebar.tsx](/D:/autoparts/components/shared/AdminSidebar.tsx)
- [ ] [components/shared/TabsBar.tsx](/D:/autoparts/components/shared/TabsBar.tsx)
- [ ] [components/shared/SearchBar.tsx](/D:/autoparts/components/shared/SearchBar.tsx)
- [ ] [components/shared/AdminSearchForm.tsx](/D:/autoparts/components/shared/AdminSearchForm.tsx)
- [ ] [components/shared/AdminSearchSubmitButton.tsx](/D:/autoparts/components/shared/AdminSearchSubmitButton.tsx)
- [ ] [lib/admin-navigation.ts](/D:/autoparts/lib/admin-navigation.ts)
- [ ] [lib/quick-search-commands.ts](/D:/autoparts/lib/quick-search-commands.ts)

### Visual Rules To Define Before Editing
- [ ] page header pattern
- [ ] section card pattern
- [ ] filter toolbar pattern
- [ ] summary stat pattern
- [ ] data table pattern
- [ ] empty state pattern
- [ ] action button priority pattern
- [ ] badge/status color pattern
- [ ] light/dark parity rules

---

## Step 2 Checklist: Shared Foundation

### 2.1 Admin Shell
- [ ] [components/shared/AdminShell.tsx](/D:/autoparts/components/shared/AdminShell.tsx)
  - [ ] ปรับ top header spacing
  - [ ] ปรับ control grouping ของ quick search / theme / user menu
  - [ ] ปรับ main padding strategy ให้คงที่
  - [ ] ปรับ warning banner visual hierarchy
  - [ ] ตรวจ responsive sidebar overlay behavior

### 2.2 Admin Sidebar
- [ ] [components/shared/AdminSidebar.tsx](/D:/autoparts/components/shared/AdminSidebar.tsx)
  - [ ] ปรับ section header spacing
  - [ ] ปรับ active nav state
  - [ ] ปรับ hover state
  - [ ] ปรับ contrast ทั้ง light/dark
  - [ ] ปรับ icon/text alignment
  - [ ] ตรวจ mobile close behavior

### 2.3 Tabs
- [ ] [components/shared/TabsBar.tsx](/D:/autoparts/components/shared/TabsBar.tsx)
  - [ ] ปรับ active tab emphasis
  - [ ] ลดความแน่นของ inactive tabs
  - [ ] ปรับ close button affordance
  - [ ] ตรวจ overflow scroll ใช้งานได้ดี

### 2.4 Search / Filter Core
- [ ] [components/shared/SearchBar.tsx](/D:/autoparts/components/shared/SearchBar.tsx)
  - [ ] ปรับ input density
  - [ ] ปรับ search action button style
  - [ ] ปรับ pending/clear behavior visual
- [ ] [components/shared/AdminSearchForm.tsx](/D:/autoparts/components/shared/AdminSearchForm.tsx)
  - [ ] review pending state class usage
  - [ ] รองรับ layout wrapper pattern ใหม่
- [ ] [components/shared/AdminSearchSubmitButton.tsx](/D:/autoparts/components/shared/AdminSearchSubmitButton.tsx)
  - [ ] ปรับ default button baseline classes
  - [ ] ตรวจ loading icon alignment

### 2.5 Shared Admin Primitives To Create Or Refactor
- [ ] สร้าง `components/shared/AdminPageHeader.tsx`
- [ ] สร้าง `components/shared/AdminSectionCard.tsx`
- [ ] สร้าง `components/shared/AdminStatCard.tsx`
- [ ] สร้าง `components/shared/AdminEmptyState.tsx`
- [ ] สร้าง `components/shared/AdminStatusBadge.tsx`
- [ ] สร้าง `components/shared/AdminActionGroup.tsx`
- [ ] สร้าง `components/shared/AdminFilterToolbar.tsx`
- [ ] ถ้าจำเป็น สร้าง `components/shared/AdminTableSection.tsx`

### 2.6 Navigation / Command Consistency
- [ ] [lib/admin-navigation.ts](/D:/autoparts/lib/admin-navigation.ts)
- [ ] [lib/quick-search-commands.ts](/D:/autoparts/lib/quick-search-commands.ts)
  - [ ] ยืนยันว่าไม่มี menu change ที่กระทบ Quick Search
  - [ ] ถ้ามี label หรือ entrypoint เปลี่ยน ต้อง sync ทั้งคู่

### 2.7 Shared Foundation QA
- [ ] ตรวจ light mode
- [ ] ตรวจ dark mode
- [ ] ตรวจ mobile sidebar
- [ ] ตรวจ tab overflow
- [ ] ตรวจ search pending state

---

## Step 3 Checklist: High-Traffic Operational Pages

## 3A. Sales

### List / Filters
- [ ] [app/admin/(protected)/sales/page.tsx](/D:/autoparts/app/admin/(protected)/sales/page.tsx)
  - [ ] ย้าย header เข้า pattern กลาง
  - [ ] จัด search/filter/date range ให้เป็น toolbar เดียว
  - [ ] จัด drilldown context ให้เป็น summary strip
  - [ ] ปรับ table density
  - [ ] ปรับ action column layout
  - [ ] ปรับ empty state
- [ ] [app/admin/(protected)/sales/SalesFilterBar.tsx](/D:/autoparts/app/admin/(protected)/sales/SalesFilterBar.tsx)
  - [ ] ปรับ segmented filter visual
  - [ ] ปรับ pending state
- [ ] ตรวจ [components/shared/DateRangeFilter.tsx](/D:/autoparts/components/shared/DateRangeFilter.tsx) ถ้าต้องใช้ style ร่วม
- [ ] ตรวจ [components/shared/Pagination.tsx](/D:/autoparts/components/shared/Pagination.tsx) ถ้าหน้าตาไม่เข้าชุด
- [ ] ตรวจ [components/shared/PrintFromListButton.tsx](/D:/autoparts/components/shared/PrintFromListButton.tsx) ถ้าปุ่ม action ยังแข็ง

### Detail / Form
- [ ] [app/admin/(protected)/sales/new/SaleForm.tsx](/D:/autoparts/app/admin/(protected)/sales/new/SaleForm.tsx)
- [ ] [app/admin/(protected)/sales/new/page.tsx](/D:/autoparts/app/admin/(protected)/sales/new/page.tsx)
- [ ] [app/admin/(protected)/sales/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/page.tsx)
- [ ] [app/admin/(protected)/sales/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/sales/SaleCancelButton.tsx](/D:/autoparts/app/admin/(protected)/sales/SaleCancelButton.tsx)
- [ ] [app/admin/(protected)/sales/[id]/PrintButton.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/PrintButton.tsx)

## 3B. Purchases
- [ ] [app/admin/(protected)/purchases/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/page.tsx)
- [ ] [app/admin/(protected)/purchases/new/PurchaseForm.tsx](/D:/autoparts/app/admin/(protected)/purchases/new/PurchaseForm.tsx)
- [ ] [app/admin/(protected)/purchases/new/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/new/page.tsx)
- [ ] [app/admin/(protected)/purchases/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/[id]/page.tsx)
- [ ] [app/admin/(protected)/purchases/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/purchases/PurchaseCancelButton.tsx](/D:/autoparts/app/admin/(protected)/purchases/PurchaseCancelButton.tsx)

## 3C. Receipts
- [ ] [app/admin/(protected)/receipts/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/page.tsx)
- [ ] [app/admin/(protected)/receipts/new/ReceiptForm.tsx](/D:/autoparts/app/admin/(protected)/receipts/new/ReceiptForm.tsx)
- [ ] [app/admin/(protected)/receipts/new/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/new/page.tsx)
- [ ] [app/admin/(protected)/receipts/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/page.tsx)
- [ ] [app/admin/(protected)/receipts/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/receipts/ReceiptCancelButton.tsx](/D:/autoparts/app/admin/(protected)/receipts/ReceiptCancelButton.tsx)
- [ ] [app/admin/(protected)/receipts/[id]/PrintButton.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/PrintButton.tsx)

## 3D. Credit Notes
- [ ] [app/admin/(protected)/credit-notes/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/page.tsx)
- [ ] [app/admin/(protected)/credit-notes/new/CreditNoteForm.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/new/CreditNoteForm.tsx)
- [ ] [app/admin/(protected)/credit-notes/new/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/new/page.tsx)
- [ ] [app/admin/(protected)/credit-notes/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/[id]/page.tsx)
- [ ] [app/admin/(protected)/credit-notes/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/credit-notes/CreditNoteCancelButton.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/CreditNoteCancelButton.tsx)

## 3E. Expenses
- [ ] [app/admin/(protected)/expenses/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/page.tsx)
- [ ] [app/admin/(protected)/expenses/new/NewExpenseForm.tsx](/D:/autoparts/app/admin/(protected)/expenses/new/NewExpenseForm.tsx)
- [ ] [app/admin/(protected)/expenses/new/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/new/page.tsx)
- [ ] [app/admin/(protected)/expenses/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/[id]/page.tsx)
- [ ] [app/admin/(protected)/expenses/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/expenses/CancelExpenseButton.tsx](/D:/autoparts/app/admin/(protected)/expenses/CancelExpenseButton.tsx)

## 3F. Supplier Advances
- [ ] [app/admin/(protected)/supplier-advances/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/page.tsx)
- [ ] [app/admin/(protected)/supplier-advances/SupplierAdvanceForm.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/SupplierAdvanceForm.tsx)
- [ ] [app/admin/(protected)/supplier-advances/new/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/new/page.tsx)
- [ ] [app/admin/(protected)/supplier-advances/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/[id]/page.tsx)
- [ ] [app/admin/(protected)/supplier-advances/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/supplier-advances/SupplierAdvanceCancelButton.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/SupplierAdvanceCancelButton.tsx)

## 3G. Supplier Payments
- [ ] [app/admin/(protected)/supplier-payments/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/page.tsx)
- [ ] [app/admin/(protected)/supplier-payments/SupplierPaymentForm.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/SupplierPaymentForm.tsx)
- [ ] [app/admin/(protected)/supplier-payments/new/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/new/page.tsx)
- [ ] [app/admin/(protected)/supplier-payments/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/[id]/page.tsx)
- [ ] [app/admin/(protected)/supplier-payments/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/supplier-payments/SupplierPaymentCancelButton.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/SupplierPaymentCancelButton.tsx)

## 3H. Delivery Commissions / Delivery Main
- [ ] [app/admin/(protected)/delivery-commissions/page.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/page.tsx)
- [ ] [app/admin/(protected)/delivery-commissions/PayoutPanel.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/PayoutPanel.tsx)
- [ ] [app/admin/(protected)/delivery-commissions/DeliveryCommissionsReportFilter.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/DeliveryCommissionsReportFilter.tsx)
- [ ] [app/admin/(protected)/delivery-commissions/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/delivery-commissions/[id]/page.tsx)
- [ ] [app/admin/(protected)/delivery/page.tsx](/D:/autoparts/app/admin/(protected)/delivery/page.tsx)
- [ ] [app/admin/(protected)/delivery/DeliveryStaffPicker.tsx](/D:/autoparts/app/admin/(protected)/delivery/DeliveryStaffPicker.tsx)
- [ ] [app/admin/(protected)/delivery/DeliveryUpdateButton.tsx](/D:/autoparts/app/admin/(protected)/delivery/DeliveryUpdateButton.tsx)
- [ ] ยืนยันว่าไม่มีการแก้ [app/admin/(protected)/delivery/update/page.tsx](/D:/autoparts/app/admin/(protected)/delivery/update/page.tsx)

### Step 3 QA
- [ ] ตรวจทุก list page ว่า filter/search ยังทำงานเหมือนเดิม
- [ ] ตรวจทุก cancel/action button ว่า state และ confirmation logic ไม่เปลี่ยน
- [ ] ตรวจ table overflow ทั้ง desktop และ mobile

---

## Step 4 Checklist: Master Data And Config

## 4A. Products
- [ ] [app/admin/(protected)/products/page.tsx](/D:/autoparts/app/admin/(protected)/products/page.tsx)
- [ ] [app/admin/(protected)/products/ProductFilterForm.tsx](/D:/autoparts/app/admin/(protected)/products/ProductFilterForm.tsx)
- [ ] [app/admin/(protected)/products/new/page.tsx](/D:/autoparts/app/admin/(protected)/products/new/page.tsx)
- [ ] [app/admin/(protected)/products/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/products/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/products/ProductImagePreview.tsx](/D:/autoparts/app/admin/(protected)/products/ProductImagePreview.tsx)
- [ ] [app/admin/(protected)/products/DeleteProductButton.tsx](/D:/autoparts/app/admin/(protected)/products/DeleteProductButton.tsx)

## 4B. Customers
- [ ] [app/admin/(protected)/customers/page.tsx](/D:/autoparts/app/admin/(protected)/customers/page.tsx)
- [ ] [app/admin/(protected)/customers/CustomerForm.tsx](/D:/autoparts/app/admin/(protected)/customers/CustomerForm.tsx)
- [ ] [app/admin/(protected)/customers/new/page.tsx](/D:/autoparts/app/admin/(protected)/customers/new/page.tsx)
- [ ] [app/admin/(protected)/customers/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/customers/[id]/page.tsx)
- [ ] [app/admin/(protected)/customers/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/customers/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/customers/DeleteCustomerButton.tsx](/D:/autoparts/app/admin/(protected)/customers/DeleteCustomerButton.tsx)

## 4C. Master Data Pages
- [ ] [app/admin/(protected)/master/suppliers/page.tsx](/D:/autoparts/app/admin/(protected)/master/suppliers/page.tsx)
- [ ] [app/admin/(protected)/master/suppliers/SuppliersClient.tsx](/D:/autoparts/app/admin/(protected)/master/suppliers/SuppliersClient.tsx)
- [ ] [app/admin/(protected)/master/categories/page.tsx](/D:/autoparts/app/admin/(protected)/master/categories/page.tsx)
- [ ] [app/admin/(protected)/master/categories/CategoryForm.tsx](/D:/autoparts/app/admin/(protected)/master/categories/CategoryForm.tsx)
- [ ] [app/admin/(protected)/master/parts-brands/page.tsx](/D:/autoparts/app/admin/(protected)/master/parts-brands/page.tsx)
- [ ] [app/admin/(protected)/master/parts-brands/PartsBrandForm.tsx](/D:/autoparts/app/admin/(protected)/master/parts-brands/PartsBrandForm.tsx)
- [ ] [app/admin/(protected)/master/car-brands/page.tsx](/D:/autoparts/app/admin/(protected)/master/car-brands/page.tsx)
- [ ] [app/admin/(protected)/master/car-brands/CarBrandsClient.tsx](/D:/autoparts/app/admin/(protected)/master/car-brands/CarBrandsClient.tsx)
- [ ] [app/admin/(protected)/master/expense-codes/page.tsx](/D:/autoparts/app/admin/(protected)/master/expense-codes/page.tsx)
- [ ] [app/admin/(protected)/master/expense-codes/ExpenseCodeClient.tsx](/D:/autoparts/app/admin/(protected)/master/expense-codes/ExpenseCodeClient.tsx)

## 4D. Users / Roles / Settings / Audit
- [ ] [app/admin/(protected)/users/page.tsx](/D:/autoparts/app/admin/(protected)/users/page.tsx)
- [ ] [app/admin/(protected)/users/UserForm.tsx](/D:/autoparts/app/admin/(protected)/users/UserForm.tsx)
- [ ] [app/admin/(protected)/users/new/page.tsx](/D:/autoparts/app/admin/(protected)/users/new/page.tsx)
- [ ] [app/admin/(protected)/users/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/users/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/users/ToggleUserButton.tsx](/D:/autoparts/app/admin/(protected)/users/ToggleUserButton.tsx)
- [ ] [app/admin/(protected)/roles/page.tsx](/D:/autoparts/app/admin/(protected)/roles/page.tsx)
- [ ] [app/admin/(protected)/roles/RoleForm.tsx](/D:/autoparts/app/admin/(protected)/roles/RoleForm.tsx)
- [ ] [app/admin/(protected)/roles/new/page.tsx](/D:/autoparts/app/admin/(protected)/roles/new/page.tsx)
- [ ] [app/admin/(protected)/roles/[id]/edit/page.tsx](/D:/autoparts/app/admin/(protected)/roles/[id]/edit/page.tsx)
- [ ] [app/admin/(protected)/settings/company/page.tsx](/D:/autoparts/app/admin/(protected)/settings/company/page.tsx)
- [ ] [app/admin/(protected)/audit-log/page.tsx](/D:/autoparts/app/admin/(protected)/audit-log/page.tsx)
- [ ] [app/admin/(protected)/audit-log/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/audit-log/[id]/page.tsx)

### Step 4 QA
- [ ] ตรวจ forms ยาวทุกตัวว่าจัด section แล้วอ่านง่ายขึ้น
- [ ] ตรวจ permission-heavy pages เช่น roles/users/audit-log ว่าไม่มี behavior change

---

## Step 5 Checklist: Dashboard, Reports, Stock, Lots

## 5A. Dashboard / Workboard
- [ ] [app/admin/(protected)/dashboard/page.tsx](/D:/autoparts/app/admin/(protected)/dashboard/page.tsx)
- [ ] [app/admin/(protected)/DashboardTabs.tsx](/D:/autoparts/app/admin/(protected)/DashboardTabs.tsx)
- [ ] [app/admin/(protected)/DailyOperationsDashboard.tsx](/D:/autoparts/app/admin/(protected)/DailyOperationsDashboard.tsx)
- [ ] [app/admin/(protected)/ProfitDashboard.tsx](/D:/autoparts/app/admin/(protected)/ProfitDashboard.tsx)
- [ ] [app/admin/(protected)/TopProductsChart.tsx](/D:/autoparts/app/admin/(protected)/TopProductsChart.tsx)
- [ ] [app/admin/(protected)/SalesChart.tsx](/D:/autoparts/app/admin/(protected)/SalesChart.tsx)
- [ ] [app/admin/(protected)/ProfitTrendPanel.tsx](/D:/autoparts/app/admin/(protected)/ProfitTrendPanel.tsx)
- [ ] [app/admin/(protected)/workboard/page.tsx](/D:/autoparts/app/admin/(protected)/workboard/page.tsx)
- [ ] [app/admin/(protected)/workboard/RefreshWorkboardButton.tsx](/D:/autoparts/app/admin/(protected)/workboard/RefreshWorkboardButton.tsx)

## 5B. Reports Navigation / Layout
- [ ] [app/admin/(protected)/reports/layout.tsx](/D:/autoparts/app/admin/(protected)/reports/layout.tsx)
- [ ] [app/admin/(protected)/reports/ReportTabNav.tsx](/D:/autoparts/app/admin/(protected)/reports/ReportTabNav.tsx)
- [ ] [app/admin/(protected)/reports/ReportsContent.tsx](/D:/autoparts/app/admin/(protected)/reports/ReportsContent.tsx)

## 5C. Reports Pages
- [ ] [app/admin/(protected)/reports/sales/page.tsx](/D:/autoparts/app/admin/(protected)/reports/sales/page.tsx)
- [ ] [app/admin/(protected)/reports/purchases/page.tsx](/D:/autoparts/app/admin/(protected)/reports/purchases/page.tsx)
- [ ] [app/admin/(protected)/reports/receipts/page.tsx](/D:/autoparts/app/admin/(protected)/reports/receipts/page.tsx)
- [ ] [app/admin/(protected)/reports/payments/page.tsx](/D:/autoparts/app/admin/(protected)/reports/payments/page.tsx)
- [ ] [app/admin/(protected)/reports/ar/page.tsx](/D:/autoparts/app/admin/(protected)/reports/ar/page.tsx)
- [ ] [app/admin/(protected)/reports/ap/page.tsx](/D:/autoparts/app/admin/(protected)/reports/ap/page.tsx)
- [ ] [app/admin/(protected)/reports/stock/page.tsx](/D:/autoparts/app/admin/(protected)/reports/stock/page.tsx)
- [ ] [app/admin/(protected)/reports/summary/page.tsx](/D:/autoparts/app/admin/(protected)/reports/summary/page.tsx)
- [ ] [app/admin/(protected)/reports/credit-notes/page.tsx](/D:/autoparts/app/admin/(protected)/reports/credit-notes/page.tsx)
- [ ] [app/admin/(protected)/reports/claim-stock/page.tsx](/D:/autoparts/app/admin/(protected)/reports/claim-stock/page.tsx)
- [ ] [app/admin/(protected)/reports/cash-bank-ledger/page.tsx](/D:/autoparts/app/admin/(protected)/reports/cash-bank-ledger/page.tsx)
- [ ] [app/admin/(protected)/reports/cash-bank-transfers/page.tsx](/D:/autoparts/app/admin/(protected)/reports/cash-bank-transfers/page.tsx)
- [ ] [app/admin/(protected)/reports/cash-bank-adjustments/page.tsx](/D:/autoparts/app/admin/(protected)/reports/cash-bank-adjustments/page.tsx)
- [ ] [app/admin/(protected)/reports/line-daily-summary/page.tsx](/D:/autoparts/app/admin/(protected)/reports/line-daily-summary/page.tsx)
- [ ] [app/admin/(protected)/reports/line-daily-summary/LineDailySummaryManager.tsx](/D:/autoparts/app/admin/(protected)/reports/line-daily-summary/LineDailySummaryManager.tsx)

## 5D. Stock / Lots
- [ ] [app/admin/(protected)/stock/bf/page.tsx](/D:/autoparts/app/admin/(protected)/stock/bf/page.tsx)
- [ ] [app/admin/(protected)/stock/bf/BfForm.tsx](/D:/autoparts/app/admin/(protected)/stock/bf/BfForm.tsx)
- [ ] [app/admin/(protected)/stock/bf/BfHistoryTable.tsx](/D:/autoparts/app/admin/(protected)/stock/bf/BfHistoryTable.tsx)
- [ ] [app/admin/(protected)/stock/adjustments/page.tsx](/D:/autoparts/app/admin/(protected)/stock/adjustments/page.tsx)
- [ ] [app/admin/(protected)/stock/adjustments/AdjustmentForm.tsx](/D:/autoparts/app/admin/(protected)/stock/adjustments/AdjustmentForm.tsx)
- [ ] [app/admin/(protected)/stock/adjustments/AdjustmentHistoryList.tsx](/D:/autoparts/app/admin/(protected)/stock/adjustments/AdjustmentHistoryList.tsx)
- [ ] [app/admin/(protected)/stock/card/page.tsx](/D:/autoparts/app/admin/(protected)/stock/card/page.tsx)
- [ ] [app/admin/(protected)/stock/card/RecalculateButton.tsx](/D:/autoparts/app/admin/(protected)/stock/card/RecalculateButton.tsx)
- [ ] [app/admin/(protected)/lots/layout.tsx](/D:/autoparts/app/admin/(protected)/lots/layout.tsx)
- [ ] [app/admin/(protected)/lots/LotTabNav.tsx](/D:/autoparts/app/admin/(protected)/lots/LotTabNav.tsx)
- [ ] [app/admin/(protected)/lots/balance/page.tsx](/D:/autoparts/app/admin/(protected)/lots/balance/page.tsx)
- [ ] [app/admin/(protected)/lots/trace/page.tsx](/D:/autoparts/app/admin/(protected)/lots/trace/page.tsx)
- [ ] [app/admin/(protected)/lots/expiry/page.tsx](/D:/autoparts/app/admin/(protected)/lots/expiry/page.tsx)
- [ ] [app/admin/(protected)/lots/slow-moving/page.tsx](/D:/autoparts/app/admin/(protected)/lots/slow-moving/page.tsx)

### Step 5 QA
- [ ] reports filter forms ยังคง submit behavior เดิม
- [ ] report sections ยาวอ่านง่ายขึ้นจริง
- [ ] stock tables scan ได้เร็วขึ้น
- [ ] dashboard cards ไม่รกและไม่เสียข้อมูลสำคัญ

---

## Step 6 Checklist: Content Workflow

- [ ] [app/admin/(protected)/content/page.tsx](/D:/autoparts/app/admin/(protected)/content/page.tsx)
- [ ] [app/admin/(protected)/content/ContentManager.tsx](/D:/autoparts/app/admin/(protected)/content/ContentManager.tsx)
- [ ] [app/admin/(protected)/content/approval-queue/page.tsx](/D:/autoparts/app/admin/(protected)/content/approval-queue/page.tsx)
- [ ] [app/admin/(protected)/content/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/content/[id]/page.tsx)
- [ ] [app/admin/(protected)/content/[id]/ContentDetailManager.tsx](/D:/autoparts/app/admin/(protected)/content/[id]/ContentDetailManager.tsx)

### UX Goals
- [ ] แยก generate / review / approve / schedule zones
- [ ] จัด status blocks ให้เห็น next action ชัด
- [ ] ลดความแน่นของ forms
- [ ] ปรับ list rows ให้สแกนง่าย

### Step 6 QA
- [ ] ปุ่ม action ทุกตัวคง behavior เดิม
- [ ] workflow states ยังเข้าใจถูกต้อง

---

## Step 7 Checklist: Detail Sweep

### Detail Pages To Normalize
- [ ] [app/admin/(protected)/sales/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/sales/[id]/page.tsx)
- [ ] [app/admin/(protected)/purchases/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/purchases/[id]/page.tsx)
- [ ] [app/admin/(protected)/receipts/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/receipts/[id]/page.tsx)
- [ ] [app/admin/(protected)/credit-notes/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/credit-notes/[id]/page.tsx)
- [ ] [app/admin/(protected)/expenses/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/expenses/[id]/page.tsx)
- [ ] [app/admin/(protected)/customers/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/customers/[id]/page.tsx)
- [ ] [app/admin/(protected)/supplier-advances/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-advances/[id]/page.tsx)
- [ ] [app/admin/(protected)/supplier-payments/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/supplier-payments/[id]/page.tsx)
- [ ] [app/admin/(protected)/warranty-claims/[id]/page.tsx](/D:/autoparts/app/admin/(protected)/warranty-claims/[id]/page.tsx)

### Common Tasks
- [ ] ทำ summary header
- [ ] ทำ status/action strip
- [ ] ปรับ section spacing
- [ ] จัด metadata grouping
- [ ] จัด related actions placement

---

## Cross-Cutting QA Checklist

### Functional Safety
- [ ] ไม่มี logic เปลี่ยน
- [ ] ไม่มี permission เปลี่ยน
- [ ] ไม่มี route contract เปลี่ยน
- [ ] ไม่มี query contract เปลี่ยนโดยไม่ตั้งใจ

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
