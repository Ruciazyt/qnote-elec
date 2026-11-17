
export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserState {
  tabs: BrowserTabState[];
  activeTabId: string | null;
}

export interface BrowserLoadError {
  tabId: string;
  url: string;
  errorCode: number;
  errorDescription: string;
}

export interface BookmarkRow {
  id: number;
  title: string | null;
  url: string;
  created_at: string;
  updated_at: string;
}
