// Facade over decomposed draft-editor sub-modules.
export { selectCategory } from './draft-editor/category-draft.js';
export { fillGoodsForm } from './draft-editor/sku-media-fill.js';
export {
  fillGoodsProperties,
  disableSizeChart,
  fillFullCountDiscount,
} from './draft-editor/property-final-state.js';
export { clickSaveDraft } from './draft-editor/save-route.js';
