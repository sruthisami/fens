export type Category = 'shoes' | 'bags' | 'accessories';
export interface Product {
  id: string;
  name: string;
  price: number;
  category: Category;
  color: string;
  description: string;
}
export const PRODUCTS: Product[] = [
  {
    id: 'shoe-1',
    name: 'Runner Low',
    price: 89,
    category: 'shoes',
    color: '#d9c7a7',
    description: 'A lightweight everyday runner.',
  },
  {
    id: 'shoe-2',
    name: 'City Boot',
    price: 129,
    category: 'shoes',
    color: '#8c6d4f',
    description: 'A water-resistant boot for city days.',
  },
  {
    id: 'bag-1',
    name: 'Canvas Tote',
    price: 59,
    category: 'bags',
    color: '#a9c4b5',
    description: 'A roomy canvas tote with a zip top.',
  },
  {
    id: 'bag-2',
    name: 'Leather Crossbody',
    price: 149,
    category: 'bags',
    color: '#6b4f3a',
    description: 'A compact leather crossbody bag.',
  },
  {
    id: 'acc-1',
    name: 'Wool Scarf',
    price: 35,
    category: 'accessories',
    color: '#b8b0d6',
    description: 'A soft merino wool scarf.',
  },
  {
    id: 'acc-2',
    name: 'Leather Belt',
    price: 45,
    category: 'accessories',
    color: '#4f3b2e',
    description: 'A full-grain leather belt.',
  },
];
export const LISTINGS: Record<Category, string[]> = {
  shoes: ['shoe-1', 'shoe-2'],
  bags: ['bag-1', 'bag-2'],
  accessories: ['bag-1', 'bag-2', 'acc-1'],
};
export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}
