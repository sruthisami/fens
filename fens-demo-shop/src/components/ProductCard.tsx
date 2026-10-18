import { Link } from 'react-router-dom';
import { getPhoto } from '../data/photos';
import type { Product } from '../data/products';
export function ProductCard({ product }: { product: Product }) {
  const photo = getPhoto(product.id);
  return (
    <article className={`product-card tint-${product.category}`} data-component="ProductCard">
      <Link to={`/product/${product.id}`}>
        <div className="card-media">
          {photo ? (
            <img src={photo.file} alt="" width={photo.width} height={photo.height} loading="lazy" />
          ) : (
            <div className="swatch" style={{ background: product.color }} aria-hidden="true" />
          )}
        </div>
        <h3 className="card-name">{product.name}</h3>
        <p className="card-price">${product.price}</p>
      </Link>
    </article>
  );
}
