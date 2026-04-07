const EditSupplierPaymentLoading = () => {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1e3a5f]/20 border-t-[#1e3a5f]" />
        <p className="text-sm text-gray-500">กำลังโหลดหน้าแก้ไขจ่ายชำระซัพพลายเออร์...</p>
      </div>
    </div>
  );
};

export default EditSupplierPaymentLoading;
