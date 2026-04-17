export interface Folder {
  id: string;
  name: string;
  userId: string;
  createdAt: number;
  isDeleted?: boolean;
  isStarred?: boolean;
  color?: string;
  parentId?: string;
  isLocked?: boolean;
}

export interface UserSettings {
  theme: 'system' | 'light' | 'dark';
  transferOverWifiOnly: boolean;
  passcode?: string;
}

export interface DriveImage {
  id: string;
  folderId: string;
  fileId: string;
  userId: string;
  createdAt: number;
  messageId?: number;
  name?: string;
  size?: number;
  isStarred?: boolean;
  // We'll fetch the actual URL asynchronously when displaying
  url?: string;
  isDeleted?: boolean;
  isOffline?: boolean;
}
