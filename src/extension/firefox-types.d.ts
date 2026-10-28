import type { ResponseFilter } from "./capture";
import type { ResponseHeader } from "./response-policy";
declare global {
  const browser: {
    webRequest: {
      filterResponseData(requestId: string): ResponseFilter;
      onBeforeRequest: {
        addListener(callback: (details: {requestId: string; tabId: number; url: string; timeStamp: number}) => void,
          filter: {urls: string[]; types: string[]}, extraInfo: string[]): void;
      };
      onHeadersReceived: {
        addListener(callback: (details: {requestId: string; tabId: number; url: string; timeStamp: number; statusCode: number; responseHeaders?: ResponseHeader[]}) => void,
          filter: {urls: string[]; types: string[]}, extraInfo: string[]): void;
      };
      onErrorOccurred: {
        addListener(callback: (details: {requestId: string}) => void, filter: {urls: string[]; types: string[]}): void;
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
