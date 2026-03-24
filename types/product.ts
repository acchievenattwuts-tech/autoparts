export interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  category: ProductCategory;
  imageUrl?: string;
  badge?: string;
}

export type ProductCategory =
  | "compressor"
  | "radiator"
  | "hose"
  | "condenser"
  | "other";

export interface Category {
  id: ProductCategory;
  label: string;
  description: string;
  icon: string;
}
