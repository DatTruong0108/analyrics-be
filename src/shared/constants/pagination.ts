/**
 * Pagination bounds for the read-only list endpoints.
 *
 * Without an upper bound a client can ask for `limit=999999`, which turns one
 * request into a full-table read plus a Spotify page the size of the catalogue.
 * The caps are what make the cost of a single request predictable.
 */

/** Highest page size any list endpoint will serve (also Spotify's own cap). */
export const MAX_PAGE_LIMIT = 50;

/** Lowest accepted page size. */
export const MIN_PAGE_LIMIT = 1;

/** Page size used when the client does not ask for one. */
export const DEFAULT_PAGE_LIMIT = 10;

/** Lowest accepted page number (pages are 1-based). */
export const MIN_PAGE = 1;

/** Page number used when the client does not ask for one. */
export const DEFAULT_PAGE = 1;

/** Lowest accepted offset. */
export const MIN_OFFSET = 0;

/**
 * Highest accepted offset. Postgres has to walk and discard every row before a
 * large OFFSET, so an unbounded value turns a trivial request into a full scan
 * of `analysis` on an unauthenticated endpoint.
 */
export const MAX_OFFSET = 1000;

/** Offset used when the client does not ask for one. */
export const DEFAULT_OFFSET = 0;

/**
 * Longest accepted search term. Anything longer cannot produce a useful Spotify
 * match and only risks an over-long upstream request URI.
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;
