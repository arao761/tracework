export {};
declare global {
  interface Window {
    traceworkDesktop?: {
      copyText: (text: string) => Promise<boolean>;
      getStatus: () => Promise<{
        version: string;
        dataDirectory: string;
        packaged: boolean;
        platform: string;
        keepRunningInBackground: boolean;
        launchAtLogin: boolean;
        updateStatus: string;
      }>;
      updateSettings: (settings: {
        keepRunningInBackground?: boolean;
        launchAtLogin?: boolean;
      }) => ReturnType<NonNullable<Window['traceworkDesktop']>['getStatus']>;
      chooseDirectory: (initial?: string) => Promise<string | null>;
      importWorkspace: () => Promise<{ message: string }>;
      openDataFolder: () => Promise<string>;
      checkUpdates: () => Promise<{ message: string }>;
    };
  }
}
