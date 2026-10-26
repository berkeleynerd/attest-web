import type { ResponseFilter } from "./capture";
declare global {
  const browser: {
    webRequest: {
      filterResponseData(requestId: string): ResponseFilter;
      onBeforeRequest: {
        addListener(callback: (details: {requestId: string; tabId: number; url: string; timeStamp: number}) => void,
          filter: {urls: string[]; types: string[]}, extraInfo: string[]): void;
      };
    };
    webNavigation: {
      onBeforeNavigate: NavigationEvent;
      onCommitted: NavigationEvent;
      onErrorOccurred: NavigationEvent;
      onHistoryStateUpdated: NavigationEvent;
    };
  };
}
interface NavigationEvent {
  addListener(callback: (details: {tabId: number; frameId: number; url: string; timeStamp: number}) => void): void;
}
