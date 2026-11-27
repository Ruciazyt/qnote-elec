import { issueCursor, readCursor } from './cursor';

export type ListQueryValue = string | number | boolean | undefined;

export interface CursorListParams {
  kind: string;
  path: string;
  query: Record<string, ListQueryValue>;
  cursor?: string;
  perPage: number;
}

export interface CursorListResult<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export interface ListPage<T> {
  items: T[];
  nextPage: number | null;
  total: number | null;
}

export class ListCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListCursorError';
  }
}

export type ListFetcher<T> = (
  path: string,
  query: Record<string, ListQueryValue>,
  page: number,
  perPage: number
) => Promise<ListPage<T>>;

export async function listWithCursor<T>(
  params: CursorListParams,
  list: ListFetcher<T>
): Promise<CursorListResult<T>> {
  let path = params.path;
  let query = params.query;
  let page = 1;
  let perPage = params.perPage;

  if (params.cursor) {
    const state = readCursor(params.cursor);
    if (!state || state.kind !== params.kind) {
      throw new ListCursorError('翻页句柄已失效，请重新执行一次列表调用');
    }
    path = state.path;
    query = state.query;
    page = state.page;
    perPage = state.perPage;
  }

  const result = await list(path, query, page, perPage);
  const nextCursor = result.nextPage
    ? issueCursor({
        kind: params.kind,
        path,
        query: Object.fromEntries(
          Object.entries(query)
            .filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== '')
            .map((entry) => [entry[0], String(entry[1])])
        ),
        page: result.nextPage,
        perPage,
      })
    : null;

  return { items: result.items, nextCursor, total: result.total };
}
