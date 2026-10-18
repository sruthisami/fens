import { ProductCard } from '../components/ProductCard';
import { getProduct } from '../data/products';
interface CategoryProps {
  title: string;
  productIds: string[];
}
export function Category({ title, productIds }: CategoryProps) {
  const products = productIds.map((id) => getProduct(id)).filter((p) => p !== undefined);
  return (
    <section>
      <h1>{title}</h1>
      <div className="grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
