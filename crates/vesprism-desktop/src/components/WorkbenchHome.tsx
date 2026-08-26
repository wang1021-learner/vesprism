import { getProduct } from '../products/catalog'
import { ProductHome } from '../products/ProductHome'

/** 工作台空态：产品表 workbench.home。 */
export function WorkbenchHome() {
  return <ProductHome product={getProduct('workbench')} />
}
