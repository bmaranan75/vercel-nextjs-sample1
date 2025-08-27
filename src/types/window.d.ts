declare global {
  interface Window {
    openAuth0Popup?: (popupRequestId?: string) => Promise<any>;
  }
}

export {};
