import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PhotoCredit } from '../components/PhotoCredit';
import { PrimaryButton } from '../components/PrimaryButton';
import { useCart } from '../cart';
import { getPhoto } from '../data/photos';
import { getProduct } from '../data/products';
import { isV2 } from '../version';
export function ProductPage({ productId }: { productId: string }) {
  const product = getProduct(productId);
  const { addItem, buyNow } = useCart();
  const navigate = useNavigate();
  const [added, setAdded] = useState(false);
  if (!product) {
    return (
      <section>
        <h1>Product not found</h1>
        <Link to="/">Back to home</Link>
      </section>
    );
  }
  const photo = getPhoto(product.id);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.id,
    offers: {
      '@type': 'Offer',
      price: product.price.toFixed(2),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
  };
  const handleAdd = async () => {
    await addItem(product.id);
    if (isV2) {
      navigate('/cart');
    } else {
      setAdded(true);
    }
  };
  const handleBuyNow = async () => {
    await buyNow(product.id);
    navigate('/checkout/billing');
  };
  return (
    <section className={`product tint-${product.category}`}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <div>
        <div className="product-media">
          {photo ? (
            <img src={photo.file} alt={product.name} width={photo.width} height={photo.height} />
          ) : (
            <div className="swatch" style={{ background: product.color }} aria-hidden="true" />
          )}
        </div>
        {photo && <PhotoCredit photo={photo} />}
      </div>
      <div className="product-info">
        <p className="eyebrow">{product.category}</p>
        <h1>{product.name}</h1>
        <p className="price">${product.price}</p>
        <p className="tagline">{product.description}</p>
        <PrimaryButton onClick={handleAdd}>Add to cart</PrimaryButton>
        {added && <p role="status">Added to cart.</p>}
        <div style={{ marginTop: '8px' }}>
          <button
            type="button"
            className="buy-now-link"
            data-component="BuyNowLink"
            onClick={handleBuyNow}
          >
            Buy now
          </button>
          <span className="buy-now-subtext">Express checkout (instant order)</span>
        </div>
      </div>
    </section>
  );
}
