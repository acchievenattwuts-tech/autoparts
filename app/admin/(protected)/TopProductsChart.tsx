"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts";

const mockData = [
  { name: "บอร์ดคอนโทรล Mitsubishi",   qty: 28,  revenue: 196000 },
  { name: "น้ำยาแอร์ R32 (1kg)",        qty: 41,  revenue: 61500  },
  { name: "มอเตอร์พัดลม 15W",           qty: 35,  revenue: 52500  },
  { name: "วาล์ว膨胀 R410A",             qty: 24,  revenue: 36000  },
  { name: "คาปาซิเตอร์ 35+5µF",         qty: 48,  revenue: 14400  },
  { name: "น้ำยาล้างแอร์ 600ml",         qty: 19,  revenue: 9500   },
  { name: "เทอร์โมสตัท 2P",             qty: 17,  revenue: 8500   },
  { name: "ฟิลเตอร์แอร์ Toyota",         qty: 13,  revenue: 7800   },
  { name: "คาปาซิเตอร์ 25+5µF",         qty: 22,  revenue: 5500   },
  { name: "รีเลย์ 5Pin 12V",            qty: 15,  revenue: 4500   },
];

const fmtRevenue = (v: unknown) => {
  const n = Number(v ?? 0);
  return n >= 1000 ? `฿${(n / 1000).toFixed(0)}k` : `฿${n}`;
};

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: { value: number; name: string; payload: { qty: number; revenue: number } }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium text-gray-800 mb-1 max-w-[180px] leading-tight">{label}</p>
      <p className="text-[#10b981]">ยอดขาย: <span className="font-semibold">฿{d.revenue.toLocaleString("th-TH")}</span></p>
      <p className="text-[#0ea5e9]">จำนวนขาย: <span className="font-semibold">{d.qty} ชิ้น</span></p>
    </div>
  );
};

const TopProductsChart = () => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
    <div className="flex items-center justify-between mb-1">
      <h2 className="font-kanit font-semibold text-gray-800">สินค้าขายดี Top 10 (เดือนนี้)</h2>
      <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">ข้อมูลตัวอย่าง</span>
    </div>
    <p className="text-xs text-gray-400 mb-3">เรียงตามยอดขาย (฿) | hover เพื่อดูจำนวนชิ้น</p>
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={mockData}
        layout="vertical"
        margin={{ top: 0, right: 64, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: "#9ca3af" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 10, fill: "#374151" }}
          tickLine={false}
          axisLine={false}
          width={160}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f9fafb" }} />
        <Bar dataKey="revenue" fill="#10b981" radius={[0, 3, 3, 0]} maxBarSize={16}>
          <LabelList
            dataKey="revenue"
            position="right"
            formatter={fmtRevenue}
            style={{ fontSize: 9, fill: "#6b7280" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default TopProductsChart;
