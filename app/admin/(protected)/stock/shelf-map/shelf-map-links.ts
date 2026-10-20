import { buildShelfMapFilterQuery, type ShelfMapFilters } from "@/lib/shelf-map-filters";

/** Links inside the shelf map page; filters always travel in the query string. */

export const SHELF_MAP_PATH = "/admin/stock/shelf-map";
export const SHELF_DETAIL_HASH = "#shelf-detail";
export const SHELF_GRID_HASH = "#shelf-grid";

export const shelfMapHref = (query: string, hash = ""): string =>
  `${SHELF_MAP_PATH}${query ? `?${query}` : ""}${hash}`;

/** Same filters, no rack/level selected. */
export const clearSelectionHref = (filters: ShelfMapFilters): string =>
  shelfMapHref(buildShelfMapFilterQuery(filters, { rackCode: "", level: null }));
