import { Link } from 'react-router-dom';
import { RedLine, SmileDoodle, StarDoodle } from '../components/Doodles';
import { PhotoCredit } from '../components/PhotoCredit';
import { ProductCard } from '../components/ProductCard';
import { getPhoto } from '../data/photos';
import { PRODUCTS } from '../data/products';
export function Home() {
  const hero = getPhoto('hero');
  return (
    <>
      <section className="hero">
        <RedLine className="hero-line" />
        <div className="hero-copy">
          <StarDoodle className="doodle doodle-star" />
          <p className="eyebrow">Everyday shoes, bags and accessories</p>
          <h1>Gear that goes everywhere</h1>
          <p className="tagline">Made to be worn, not kept in the box.</p>
          <Link to="/shoes" className="btn-primary">
            Shop shoes
          </Link>
        </div>
        <SmileDoodle className="doodle doodle-smile" />
        <div className="hero-media">
          {hero && <img src={hero.file} alt={hero.alt} width={hero.width} height={hero.height} />}
        </div>
      </section>
      {hero && <PhotoCredit photo={hero} />}

      <section className="camera-roll">
        <p className="eyebrow">The camera roll</p>
        <h2 className="serif-heading">Fence, autumn 2026 selects</h2>
        <div className="roll">
          {PRODUCTS.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">Shop by category</p>
        <div className="tiles">
          <Link to="/shoes" className="tile tint-shoes">
            Shoes
          </Link>
          <Link to="/bags" className="tile tint-bags">
            Bags
          </Link>
          <Link to="/accessories" className="tile tint-accessories">
            Accessories
          </Link>
        </div>
      </section>
    </>
  );
}
