import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, where, getDocs, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { PieChart, Pie, Cell } from 'recharts';
import { 
  Folder, Plus, Upload, Image as ImageIcon, Menu, X, AlertCircle, LogOut, Lock,
  Search, MoreVertical, Home, Star, Users, Clock, CheckCircle, Trash2, AlertOctagon, Settings, HelpCircle, Cloud, Camera, Grid, List, RotateCcw, ArrowLeft,
  FileText, Table, MonitorPlay, Link, Edit2, Palette, CornerUpRight, FolderOutput, Info, Copy, Share2, Download, HardDrive, SlidersHorizontal
} from 'lucide-react';
import { db, auth } from './lib/firebase';
import { uploadImageToTelegram, getImageUrlFromTelegram } from './lib/telegram';
import type { Folder as FolderType, DriveImage, UserSettings } from './types';
import { cn } from './lib/utils';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [folders, setFolders] = useState<FolderType[]>(() => {
    const cached = localStorage.getItem('cached_folders');
    return cached ? JSON.parse(cached) : [];
  });
  const [images, setImages] = useState<DriveImage[]>(() => {
    const cached = localStorage.getItem('cached_images');
    return cached ? JSON.parse(cached) : [];
  });
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() => localStorage.getItem('selectedFolderId') || null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Navigation State
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('activeTab') || 'files');
  const [sidebarView, setSidebarView] = useState<'drive' | 'recent' | 'trash' | 'starred' | 'offline'>(() => (localStorage.getItem('sidebarView') as any) || 'drive');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => (localStorage.getItem('viewMode') as any) || 'grid');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);
  
  // Settings & Security State
  const [settings, setSettings] = useState<UserSettings>(() => {
    const cached = localStorage.getItem('user_settings');
    return cached ? JSON.parse(cached) : { theme: 'system', transferOverWifiOnly: false };
  });
  const [passcodeModal, setPasscodeModal] = useState<{ id: string; type: 'folder' | 'unlock_toggle'; folder?: FolderType; onSuccess: () => void } | null>(null);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState(false);
  const [showPasscodeSetup, setShowPasscodeSetup] = useState(false);
  const [oldPasscode, setOldPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');

  // Image URL caching
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  // Folder actions state
  const [activeFolderMenu, setActiveFolderMenu] = useState<FolderType | null>(null);
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [selectedFolderColor, setSelectedFolderColor] = useState('#8c4a43');

  // Image actions state
  const [activeImageMenu, setActiveImageMenu] = useState<DriveImage | null>(null);
  const [isRenamingImage, setIsRenamingImage] = useState(false);
  const [isStorageModalOpen, setIsStorageModalOpen] = useState(false);
  const [renameImageName, setRenameImageName] = useState('');
  const [imageInfoModal, setImageInfoModal] = useState<DriveImage | null>(null);
  const [deleteChannelConfirm, setDeleteChannelConfirm] = useState<DriveImage | null>(null);
  const [movingItem, setMovingItem] = useState<{ id: string; type: 'folder' | 'image'; currentParentId: string | null } | null>(null);
  const [draggedItem, setDraggedItem] = useState<{ id: string; type: 'folder' | 'image' } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const sidebarFileInputRef = useRef<HTMLInputElement>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [searchType, setSearchType] = useState<'all' | 'folders' | 'images'>('all');
  const [searchDate, setSearchDate] = useState<'all' | 'today' | 'last7' | 'last30'>('all');
  const [searchSize, setSearchSize] = useState<'all' | 'small' | 'medium' | 'large'>('all');

  // Theme support
  useEffect(() => {
    const applyTheme = (theme: 'system' | 'light' | 'dark') => {
      const root = window.document.documentElement;
      let effectiveTheme = theme;
      if (theme === 'system') {
        effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      
      root.classList.remove('light', 'dark');
      root.classList.add(effectiveTheme);
      
      // Update data-theme for css variables if needed
      root.setAttribute('data-theme', effectiveTheme);
    };

    applyTheme(settings.theme);
    
    if (settings.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('system');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [settings.theme]);

  // Sync Settings from Firestore
  useEffect(() => {
    if (!db || !user || !isAuthReady) return;

    const unsubscribe = onSnapshot(doc(db, 'userSettings', user.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data() as UserSettings;
        setSettings(data);
        localStorage.setItem('user_settings', JSON.stringify(data));
      }
    }, (err) => {
      console.error("UserSettings sync error:", err);
      handleFirestoreError(err, OperationType.GET, `userSettings/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const updateSettings = async (newSettings: Partial<UserSettings>) => {
    if (!db || !user) return;
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    localStorage.setItem('user_settings', JSON.stringify(updated));
    try {
      await updateDoc(doc(db, 'userSettings', user.uid), {
        ...newSettings,
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      // If doc doesn't exist, set it
      try {
        const { setDoc } = await import('firebase/firestore');
        await setDoc(doc(db, 'userSettings', user.uid), {
          ...updated,
          updatedAt: serverTimestamp()
        });
      } catch (innerErr) {
        console.error("Failed to sync settings:", innerErr);
      }
    }
  };

  // Sync state to localStorage
  useEffect(() => { localStorage.setItem('activeTab', activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem('sidebarView', sidebarView); }, [sidebarView]);
  useEffect(() => { localStorage.setItem('viewMode', viewMode); }, [viewMode]);
  useEffect(() => { 
    if (selectedFolderId) localStorage.setItem('selectedFolderId', selectedFolderId); 
    else localStorage.removeItem('selectedFolderId');
  }, [selectedFolderId]);

  useEffect(() => { localStorage.setItem('cached_folders', JSON.stringify(folders)); }, [folders]);
  useEffect(() => { localStorage.setItem('cached_images', JSON.stringify(images)); }, [images]);

  const ADMIN_EMAIL = "saifulalammasud8@gmail.com";

  const verifyUserAccess = async (currentUser: User) => {
    if (currentUser.email === ADMIN_EMAIL) return true;
    try {
      const q = query(collection(db, 'allowedUsers'), where('email', '==', currentUser.email));
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (err) {
      console.error("Error verifying access:", err);
      return false;
    }
  };

  // Handle Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const isAllowed = await verifyUserAccess(currentUser);
        if (isAllowed) {
          setUser(currentUser);
          localStorage.setItem('wasLoggedIn', 'true');
        } else {
          await signOut(auth);
          setUser(null);
          localStorage.removeItem('wasLoggedIn');
          setError("Access Denied: Your email is not authorized to use this app.");
        }
      } else {
        setUser(null);
        localStorage.removeItem('wasLoggedIn');
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      setError(null);
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      
      const isAllowed = await verifyUserAccess(result.user);
      if (!isAllowed) {
        await signOut(auth);
        setError("Access Denied: Your email is not authorized to use this app.");
      }
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(err.message || "Failed to login");
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setFolders([]);
      setImages([]);
      setSelectedFolderId(null);
      setIsSidebarOpen(false);
    } catch (err: any) {
      setError(err.message || "Failed to logout");
    }
  };

  // Load ALL folders for user
  useEffect(() => {
    if (!db || !user || !isAuthReady) return;

    const q = query(
      collection(db, 'folders'), 
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const foldersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis() || Date.now()
      })) as FolderType[];
      
      setFolders(foldersData);
    }, (err) => {
      console.error("Folders sync error:", err);
      setError("Failed to load folders. Check Firebase permissions.");
      handleFirestoreError(err, OperationType.LIST, 'folders');
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Load ALL images for user
  useEffect(() => {
    if (!db || !user || !isAuthReady) return;

    const q = query(
      collection(db, 'images'), 
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const allImages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis() || Date.now()
      })) as DriveImage[];
      
      setImages(allImages);

      // Fetch URLs asynchronously and update local cache
      allImages.forEach(img => {
        if (!imageUrls[img.fileId]) {
          getImageUrlFromTelegram(img.fileId).then(url => {
            setImageUrls(prev => ({ ...prev, [img.fileId]: url }));
          }).catch(err => {
            console.error(`Failed to load URL for image ${img.fileId}:`, err);
          });
        }
      });
    }, (err) => {
      setError("Failed to load images.");
      handleFirestoreError(err, OperationType.LIST, 'images');
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !newFolderName.trim() || !user) return;

    if (folders.some(f => f.name === newFolderName.trim() && f.parentId === (selectedFolderId || 'root'))) {
      setError("A folder with this name already exists in this location.");
      return;
    }

    try {
      setIsCreatingFolder(true);
      await addDoc(collection(db, 'folders'), {
        name: newFolderName.trim(),
        userId: user.uid,
        createdAt: serverTimestamp(),
        isDeleted: false,
        parentId: selectedFolderId || 'root',
        isStarred: false,
        color: selectedFolderColor
      });
      setNewFolderName('');
      setSelectedFolderColor('#8c4a43');
      setIsCreatingFolder(false);
    } catch (err) {
      setError("Failed to create folder.");
      handleFirestoreError(err, OperationType.CREATE, 'folders');
      setIsCreatingFolder(false);
    }
  };

  const handleRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !renameFolderName.trim() || !user || !activeFolderMenu) return;

    try {
      await updateDoc(doc(db, 'folders', activeFolderMenu.id), {
        name: renameFolderName.trim()
      });
      setRenameFolderName('');
      setIsRenamingFolder(false);
      setActiveFolderMenu(null);
    } catch (err) {
      setError("Failed to rename folder.");
      handleFirestoreError(err, OperationType.UPDATE, `folders/${activeFolderMenu.id}`);
    }
  };

  const handleToggleFolderStar = async (folder: FolderType) => {
    if (!db || !user) return;
    try {
      await updateDoc(doc(db, 'folders', folder.id), {
        isStarred: !folder.isStarred
      });
      setActiveFolderMenu(null);
    } catch (err) {
      setError("Failed to update folder.");
      handleFirestoreError(err, OperationType.UPDATE, `folders/${folder.id}`);
    }
  };

  const handleToggleFolderLock = async (folder: FolderType) => {
    if (!db || !user) return;
    
    // If setting a lock, check if passcode exists
    if (!folder.isLocked && !settings.passcode) {
      setError("Please set a passcode in settings first.");
      setShowPasscodeSetup(true);
      setActiveFolderMenu(null);
      return;
    }

    // If currently locked, require passcode to UNLOCK it via menu
    if (folder.isLocked) {
      setPasscodeModal({
        id: folder.id,
        type: 'unlock_toggle',
        folder: folder,
        onSuccess: async () => {
          await updateDoc(doc(db, 'folders', folder.id), {
            isLocked: false
          });
          setActiveFolderMenu(null);
        }
      });
      setActiveFolderMenu(null);
      return;
    }
    
    try {
      await updateDoc(doc(db, 'folders', folder.id), {
        isLocked: true
      });
      setActiveFolderMenu(null);
    } catch (err) {
      setError("Failed to toggle folder lock.");
      handleFirestoreError(err, OperationType.UPDATE, `folders/${folder.id}`);
    }
  };

  const handleOpenFolder = (folder: FolderType) => {
    if (sidebarView === 'trash') return;
    
    const openAction = () => {
      setSidebarView('drive');
      setActiveTab('files');
      setSelectedFolderId(folder.id);
      setSearchQuery('');
      setSearchType('all');
      setSearchDate('all');
      setSearchSize('all');
      setIsFilterMenuOpen(false);
    };

    if (folder.isLocked) {
      setPasscodeModal({
        id: folder.id,
        type: 'folder',
        onSuccess: openAction
      });
      setPasscodeInput('');
      setPasscodeError(false);
    } else {
      openAction();
    }
  };

  const verifyPasscode = () => {
    if (passcodeInput === settings.passcode) {
      passcodeModal?.onSuccess();
      setPasscodeModal(null);
      setPasscodeInput('');
      setPasscodeError(false);
    } else {
      setPasscodeError(true);
      // Reset input after a short delay so user can try again
      setTimeout(() => {
        setPasscodeInput('');
        setPasscodeError(false);
      }, 500);
    }
  };

  const handleSetPasscode = async () => {
    if (settings.passcode && oldPasscode !== settings.passcode) {
      alert("Old passcode is incorrect");
      return;
    }
    if (newPasscode.length < 4) {
      alert("Passcode must be at least 4 digits");
      return;
    }
    if (newPasscode !== confirmPasscode) {
      alert("Passcodes do not match");
      return;
    }
    await updateSettings({ passcode: newPasscode });
    setShowPasscodeSetup(false);
    setOldPasscode('');
    setNewPasscode('');
    setConfirmPasscode('');
    alert("Passcode set successfully");
  };

  const handleRenameImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !renameImageName.trim() || !user || !activeImageMenu) return;

    try {
      await updateDoc(doc(db, 'images', activeImageMenu.id), {
        name: renameImageName.trim()
      });
      setRenameImageName('');
      setIsRenamingImage(false);
      setActiveImageMenu(null);
    } catch (err) {
      setError("Failed to rename image.");
      handleFirestoreError(err, OperationType.UPDATE, `images/${activeImageMenu.id}`);
    }
  };

  const handleToggleImageStar = async (image: DriveImage) => {
    if (!db || !user) return;
    try {
      await updateDoc(doc(db, 'images', image.id), {
        isStarred: !image.isStarred
      });
      setActiveImageMenu(null);
    } catch (err) {
      setError("Failed to update image.");
      handleFirestoreError(err, OperationType.UPDATE, `images/${image.id}`);
    }
  };

  const handleDownloadImage = async (image: DriveImage) => {
    const url = imageUrls[image.fileId] || image.url;
    if (!url) {
      alert("Image is still loading...");
      return;
    }
    setActiveImageMenu(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Network response was not ok");
      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = image.name || `Image_${image.id.slice(0, 6)}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.warn("Direct download failed, opening in a new tab...", error);
      // Fallback for CORS errors
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.download = image.name || `Image_${image.id.slice(0, 6)}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const handleMakeCopy = async (image: DriveImage) => {
    if (!db || !user) return;
    setActiveImageMenu(null);
    try {
      const copyName = image.name ? `Copy of ${image.name}` : `Image_${image.id.slice(0,6)}_copy.jpg`;
      await addDoc(collection(db, 'images'), {
        folderId: image.folderId,
        fileId: image.fileId,
        messageId: image.messageId || null,
        name: copyName,
        size: image.size || 0,
        userId: user.uid,
        createdAt: serverTimestamp(),
        isDeleted: false,
        isStarred: false
      });
    } catch (err) {
      setError("Failed to make a copy.");
      handleFirestoreError(err, OperationType.CREATE, 'images');
    }
  };

  const handleMoveImage = async (targetFolderId: string) => {
    if (!db || !user || !movingItem) return;
    handleMoveItem(movingItem.id, movingItem.type, targetFolderId);
    setMovingItem(null);
  };

  const handleMoveItem = async (itemId: string, type: 'folder' | 'image', targetFolderId: string) => {
    if (!db || !user) return;
    try {
      if (type === 'folder') {
        // Prevent moving a folder into itself
        if (itemId === targetFolderId) return;
        await updateDoc(doc(db, 'folders', itemId), {
          parentId: targetFolderId
        });
      } else {
        await updateDoc(doc(db, 'images', itemId), {
          folderId: targetFolderId
        });
      }
    } catch (err) {
      setError(`Failed to move ${type}.`);
      handleFirestoreError(err, OperationType.UPDATE, `${type}s/${itemId}`);
    }
  };

  const handleDragStart = (e: React.DragEvent, id: string, type: 'folder' | 'image') => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedItem({ id, type });
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (draggedItem) {
      // Prevent dropping a folder into itself
      if (draggedItem.type === 'folder' && draggedItem.id === id) return;
      setDragOverFolderId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    setDragOverFolderId(null);
    if (draggedItem) {
      handleMoveItem(draggedItem.id, draggedItem.type, targetFolderId);
      setDraggedItem(null);
    }
  };

  const handleDeleteFromChannel = async () => {
    if (!db || !user || !deleteChannelConfirm) return;
    const imageId = deleteChannelConfirm.id;
    const messageId = deleteChannelConfirm.messageId;
    
    setDeleteChannelConfirm(null);
    setActiveImageMenu(null);

    try {
      // 1. Delete document from Firestore
      await deleteDoc(doc(db, 'images', imageId));
      
      // 2. Delete message from Telegram if we have messageId
      if (messageId) {
        // We'll import deleteImageFromTelegram at the top
        const { deleteImageFromTelegram } = await import('./lib/telegram');
        await deleteImageFromTelegram(messageId);
      }
    } catch (err) {
      setError("Failed to delete from channel.");
      handleFirestoreError(err, OperationType.DELETE, `images/${imageId}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, specificFolderId?: string) => {
    const file = e.target.files?.[0];
    if (!file || !db || !user) return;

    // Check Wi-Fi setting
    if (settings.transferOverWifiOnly) {
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn && conn.type && conn.type !== 'wifi' && conn.type !== 'ethernet' && conn.type !== 'unknown') {
        setError("Upload paused: WiFi settings enabled but no WiFi connection detected.");
        return;
      }
    }

    try {
      setIsUploading(true);
      setError(null);
      
      // 1. Upload to Telegram
      const { fileId, messageId } = await uploadImageToTelegram(file);
      
      // 2. Save metadata to Firestore
      let targetFolderId = specificFolderId || selectedFolderId || 'root';
      
      // If triggered from sidebar, specificFolderId will be 'undefined_lookup'
      if (specificFolderId === 'undefined_lookup') {
        const undefinedFolder = folders.find(f => f.name.toLowerCase() === 'undefined' && !f.isDeleted);
        if (undefinedFolder) {
          targetFolderId = undefinedFolder.id;
        } else {
          try {
            const docRef = await addDoc(collection(db, 'folders'), {
              name: 'undefined',
              userId: user.uid,
              createdAt: serverTimestamp(),
              isStarred: false,
              isDeleted: false
            });
            targetFolderId = docRef.id;
          } catch (err) {
            targetFolderId = 'root';
          }
        }
      }

      await addDoc(collection(db, 'images'), {
        folderId: targetFolderId,
        fileId: fileId,
        messageId: messageId,
        name: file.name,
        size: file.size,
        userId: user.uid,
        createdAt: serverTimestamp(),
        isDeleted: false,
        isStarred: false
      });
      
    } catch (err: any) {
      setError(err.message || "Failed to upload image.");
      if (err.message && !err.message.includes("Telegram")) {
        handleFirestoreError(err, OperationType.CREATE, 'images');
      }
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  const handleEmptyTrash = async () => {
    if (!db || !user || (trashFolders.length === 0 && trashImages.length === 0)) return;
    
    if (!window.confirm("Are you sure you want to permanently delete all items in trash?")) return;

    try {
      setError(null);
      
      // Delete folders
      const folderDeletions = trashFolders.map(folder => deleteDoc(doc(db, 'folders', folder.id)));
      
      // Delete images
      const { deleteImageFromTelegram } = await import('./lib/telegram');
      const imageDeletions = trashImages.map(async (image) => {
        const activeCopy = activeImages.find(img => img.fileId === image.fileId);
        if (!activeCopy && image.messageId) {
          try {
            await deleteImageFromTelegram(image.messageId);
          } catch (e) {
            console.error("Failed to delete from telegram:", e);
          }
        }
        return deleteDoc(doc(db, 'images', image.id));
      });

      await Promise.all([...folderDeletions, ...imageDeletions]);
      alert("Trash emptied successfully");
    } catch (err) {
      console.error("Empty trash error:", err);
      setError("Failed to empty trash.");
      handleFirestoreError(err, OperationType.DELETE, 'bulk');
    }
  };

  const handleSoftDelete = async (e: React.MouseEvent, collectionName: string, id: string) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, collectionName, id), { isDeleted: true });
      if (collectionName === 'folders' && selectedFolderId === id) {
        setSelectedFolderId(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, collectionName);
    }
  };

  const handleRestore = async (e: React.MouseEvent, collectionName: string, id: string) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, collectionName, id), { isDeleted: false });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, collectionName);
    }
  };

  const handlePermanentDelete = async (e: React.MouseEvent, collectionName: string, id: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, collectionName, id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, collectionName);
    }
  };

  // Derived State for Views
  const activeFolders = folders.filter(f => !f.isDeleted);
  const trashFolders = folders.filter(f => f.isDeleted);
  const activeImages = images.filter(i => !i.isDeleted);
  const trashImages = images.filter(i => i.isDeleted);
  const rootImages = activeImages.filter(i => i.folderId === 'root');
  const currentFolderImages = activeImages.filter(i => i.folderId === selectedFolderId);
  const recentImages = [...activeImages].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  const starredFolders = activeFolders.filter(f => f.isStarred);
  const starredImages = activeImages.filter(i => i.isStarred);
  const offlineImages = activeImages.filter(i => i.isOffline);
  
  const selectedFolder = folders.find(f => f.id === selectedFolderId);

  let displayFolders: FolderType[] = [];
  let displayImages: DriveImage[] = [];
  let viewTitle = "My Drive";

  if (activeTab === 'starred' || sidebarView === 'starred') {
    displayFolders = starredFolders;
    displayImages = starredImages;
    viewTitle = "Starred";
  } else if (sidebarView === 'offline') {
    displayFolders = [];
    displayImages = offlineImages;
    viewTitle = "Offline";
  } else if (sidebarView === 'recent') {
    displayImages = recentImages;
    viewTitle = "Recent";
  } else if (sidebarView === 'trash') {
    displayFolders = trashFolders;
    displayImages = trashImages;
    viewTitle = "Trash";
  } else {
    // sidebarView === 'drive'
    if (selectedFolderId) {
      displayFolders = activeFolders.filter(f => f.parentId === selectedFolderId);
      displayImages = currentFolderImages;
      viewTitle = activeFolders.find(f => f.id === selectedFolderId)?.name || "Folder";
    } else {
      const rootFolders = activeFolders.filter(f => !f.parentId || f.parentId === 'root');
      if (activeTab === 'home') {
        displayFolders = rootFolders;
        displayImages = recentImages.slice(0, 6); // Show a few recent in home
        viewTitle = "Home";
      } else {
        displayFolders = rootFolders;
        displayImages = rootImages;
        viewTitle = "My Drive";
      }
    }
  }

  // Apply Search & Filters
  const isSearching = searchQuery.trim() !== '' || searchType !== 'all' || searchDate !== 'all' || searchSize !== 'all';
  
  if (isSearching && sidebarView !== 'trash') {
    viewTitle = "Search Results";
    
    // Filter functions
    const checkDate = (timestamp: number) => {
      if (searchDate === 'all') return true;
      const now = Date.now();
      const days = (now - timestamp) / (1000 * 60 * 60 * 24);
      if (searchDate === 'today') return days <= 1;
      if (searchDate === 'last7') return days <= 7;
      if (searchDate === 'last30') return days <= 30;
      return true;
    };

    const checkSize = (size?: number) => {
      if (searchSize === 'all') return true;
      const mb = (size || 0) / (1024 * 1024);
      if (searchSize === 'small') return mb < 1;
      if (searchSize === 'medium') return mb >= 1 && mb < 10;
      if (searchSize === 'large') return mb >= 10;
      return true;
    };

    const q = searchQuery.toLowerCase().trim();

    if (searchType === 'all' || searchType === 'folders') {
      displayFolders = activeFolders.filter(f => 
        (q === '' || f.name.toLowerCase().includes(q)) && 
        checkDate(f.createdAt)
      );
    } else {
      displayFolders = [];
    }

    if (searchType === 'all' || searchType === 'images') {
      displayImages = activeImages.filter(i => {
        const nameMatch = q === '' || (i.name || `Image_${i.id.slice(0,6)}.jpg`).toLowerCase().includes(q);
        return nameMatch && checkDate(i.createdAt) && checkSize(i.size);
      });
    } else {
      displayImages = [];
    }
  }

  if (!isAuthReady) {
    const wasLoggedIn = localStorage.getItem('wasLoggedIn') === 'true';
    if (wasLoggedIn) {
      // Show a skeleton of the app while auth initializes
      return (
        <div className="flex h-screen bg-app-bg text-text-main font-sans overflow-hidden relative">
          <main className="flex-1 flex flex-col min-w-0 h-full relative">
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-3 bg-search-bg rounded-full px-4 py-2.5 h-12 animate-pulse" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          </main>
        </div>
      );
    }
    return <div className="h-screen bg-app-bg" />;
  }

  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center bg-app-bg">
        <div className="bg-card-bg p-8 rounded-2xl shadow-sm border border-border text-center max-w-md w-full mx-4">
          <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Folder className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-text-main mb-2">Google Drive</h1>
          <p className="text-text-muted mb-8">Sign in to manage your files and folders.</p>
          {error && (
            <div className="bg-red-900/20 border border-red-500/50 text-red-200 p-3 rounded-lg mb-6 text-sm">
              {error}
            </div>
          )}
          <button 
            onClick={handleLogin}
            className="w-full bg-primary text-[#ffdad5] py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-app-bg text-text-main font-sans overflow-hidden relative">
      
      {/* Image Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
        >
          <button 
            className="absolute top-4 right-4 text-white p-2 hover:bg-white/10 rounded-full transition-colors"
            onClick={() => setPreviewImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img 
            src={previewImage} 
            className="max-w-full max-h-full object-contain p-4" 
            alt="Preview" 
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Drawer Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Drawer */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-[300px] bg-sidebar-bg transform transition-transform duration-300 ease-in-out flex flex-col rounded-r-2xl",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="text-xl font-medium text-text-main">Google Drive</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-text-muted">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-3 space-y-0.5">
            <button 
              onClick={() => { setSidebarView('recent'); setIsSidebarOpen(false); }}
              className={cn("w-full flex items-center gap-4 px-4 py-3 rounded-full transition-colors", sidebarView === 'recent' ? "bg-primary/20 text-primary" : "text-text-main hover:bg-white/5")}
            >
              <Clock className={cn("w-5 h-5", sidebarView === 'recent' ? "text-primary" : "text-text-muted")} />
              <span className="text-sm font-medium">Recent</span>
            </button>
            <button 
              onClick={() => { sidebarFileInputRef.current?.click(); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-4 px-4 py-3 text-text-main hover:bg-white/5 rounded-full transition-colors"
            >
              <Upload className="w-5 h-5 text-text-muted" />
              <span className="text-sm font-medium">Uploads</span>
            </button>
            <input 
              type="file" 
              ref={sidebarFileInputRef} 
              className="hidden" 
              accept="image/*"
              onChange={(e) => handleFileUpload(e, 'undefined_lookup')}
            />
            <button 
              onClick={() => { setSidebarView('offline'); setIsSidebarOpen(false); }}
              className={cn("w-full flex items-center gap-4 px-4 py-3 rounded-full transition-colors", sidebarView === 'offline' ? "bg-primary/20 text-primary" : "text-text-main hover:bg-white/5")}
            >
              <CheckCircle className={cn("w-5 h-5", sidebarView === 'offline' ? "text-primary" : "text-text-muted")} />
              <span className="text-sm font-medium">Offline</span>
            </button>
            <button 
              onClick={() => { setSidebarView('trash'); setIsSidebarOpen(false); }}
              className={cn("w-full flex items-center gap-4 px-4 py-3 rounded-full transition-colors", sidebarView === 'trash' ? "bg-primary/20 text-primary" : "text-text-main hover:bg-white/5")}
            >
              <Trash2 className={cn("w-5 h-5", sidebarView === 'trash' ? "text-primary" : "text-text-muted")} />
              <span className="text-sm font-medium">Trash</span>
            </button>
            
            <div className="h-px bg-border my-2 mx-4" />
            
            <button 
              onClick={() => { setIsSettingsOpen(true); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-4 px-4 py-3 text-text-main hover:bg-white/5 rounded-full transition-colors"
            >
              <Settings className="w-5 h-5 text-text-muted" />
              <span className="text-sm font-medium">Settings</span>
            </button>
            <button
              onClick={() => { setIsStorageModalOpen(true); setIsSidebarOpen(false); }}
              className="w-full flex items-center gap-4 px-4 py-3 text-text-main hover:bg-white/5 rounded-full transition-colors"
            >
              <Cloud className="w-5 h-5 text-text-muted" />
              <span className="text-sm font-medium">Storage</span>
            </button>
          </div>
          
          <div className="px-7 py-4">
            <div className="w-full bg-border h-1 rounded-full overflow-hidden">
              <div className="bg-primary h-full w-[60%]" />
            </div>
            <p className="text-xs text-text-muted mt-2">
              {((folders.reduce((acc, f) => acc + (f.size || 0), 0) + images.reduce((acc, i) => acc + (i.size || 0), 0)) / (1024 * 1024 * 1024)).toFixed(2)} GB used
            </p>
          </div>
        </div>
        
        <div className="p-4 border-t border-border">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-text-muted hover:bg-white/5 rounded-full transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm font-medium">Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Top Search Bar Area */}
        <div className="px-4 pt-4 pb-2 flex flex-col gap-2">
          <div className="flex items-center gap-3 bg-search-bg rounded-full px-4 py-2.5">
            <button onClick={() => setIsSidebarOpen(true)} className="text-text-main">
              <Menu className="w-6 h-6" />
            </button>
            <input 
              type="text" 
              placeholder="Search in Drive" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-text-main placeholder:text-text-muted text-base min-w-0"
            />
            <button onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)} className={cn("text-text-muted hover:text-primary transition-colors p-1 rounded-full", isFilterMenuOpen && "text-primary bg-primary/10")}>
              <SlidersHorizontal className="w-5 h-5" />
            </button>
            {user.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full shrink-0" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 bg-border rounded-full shrink-0" />
            )}
          </div>
          
          {/* Advanced Search Filters */}
          {isFilterMenuOpen && (
            <div className="bg-card-bg border border-border rounded-2xl p-4 shadow-sm animate-in slide-in-from-top-2 flex flex-col gap-3">
              <div>
                <p className="text-xs font-semibold text-text-muted mb-2 uppercase">Type</p>
                <div className="flex gap-2 text-sm">
                  <button onClick={() => setSearchType('all')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchType === 'all' && "bg-primary/20 text-primary border-transparent font-medium")}>All</button>
                  <button onClick={() => setSearchType('folders')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchType === 'folders' && "bg-primary/20 text-primary border-transparent font-medium")}>Folders</button>
                  <button onClick={() => setSearchType('images')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchType === 'images' && "bg-primary/20 text-primary border-transparent font-medium")}>Images</button>
                </div>
              </div>
              
              <div>
                <p className="text-xs font-semibold text-text-muted mb-2 uppercase">Date Modified</p>
                <div className="flex gap-2 text-sm flex-wrap">
                  <button onClick={() => setSearchDate('all')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchDate === 'all' && "bg-primary/20 text-primary border-transparent font-medium")}>Any time</button>
                  <button onClick={() => setSearchDate('today')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchDate === 'today' && "bg-primary/20 text-primary border-transparent font-medium")}>Today</button>
                  <button onClick={() => setSearchDate('last7')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchDate === 'last7' && "bg-primary/20 text-primary border-transparent font-medium")}>Last 7 days</button>
                  <button onClick={() => setSearchDate('last30')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchDate === 'last30' && "bg-primary/20 text-primary border-transparent font-medium")}>Last 30 days</button>
                </div>
              </div>
              
              <div>
                <p className="text-xs font-semibold text-text-muted mb-2 uppercase">Size</p>
                <div className="flex gap-2 text-sm flex-wrap">
                  <button onClick={() => setSearchSize('all')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchSize === 'all' && "bg-primary/20 text-primary border-transparent font-medium")}>Any size</button>
                  <button onClick={() => setSearchSize('small')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchSize === 'small' && "bg-primary/20 text-primary border-transparent font-medium")}>Small (&lt;1MB)</button>
                  <button onClick={() => setSearchSize('medium')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchSize === 'medium' && "bg-primary/20 text-primary border-transparent font-medium")}>Medium (1-10MB)</button>
                  <button onClick={() => setSearchSize('large')} className={cn("px-3 py-1.5 rounded-full border border-border transition-colors", searchSize === 'large' && "bg-primary/20 text-primary border-transparent font-medium")}>Large (&gt;10MB)</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        {!selectedFolder && sidebarView === 'drive' && !isSearching && (
          <div className="flex px-4 border-b border-border">
            <button className="flex-1 py-3 text-sm font-medium text-primary border-b-2 border-primary">
              My Drive
            </button>
            <button className="flex-1 py-3 text-sm font-medium text-text-muted">
              Computers
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pb-24">
          
          {/* Header Actions */}
          <div className="px-4 py-3 flex items-center justify-between">
            {selectedFolder && sidebarView === 'drive' && !isSearching ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setSelectedFolderId(null)}
                  onDragOver={(e) => handleDragOver(e, 'root')}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(e) => handleDrop(e, 'root')}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1 rounded-lg transition-all",
                    dragOverFolderId === 'root' && "bg-primary/20 scale-105 border border-primary shadow-lg"
                  )}
                >
                  <ArrowLeft className="w-5 h-5 text-text-muted" />
                  <span className="text-text-muted text-sm font-medium">My Drive</span>
                  <span className="text-text-muted text-xs">/</span>
                </button>
                <h1 className="text-lg font-medium text-text-main truncate max-w-[150px]">{viewTitle}</h1>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1 text-sm text-text-main font-medium">
                  {viewTitle} <span className="text-xs">↑</span>
                </button>
                {sidebarView === 'trash' && (trashFolders.length > 0 || trashImages.length > 0) && (
                  <button 
                    onClick={handleEmptyTrash}
                    className="text-[10px] bg-red-500/10 text-red-500 px-2 py-1 rounded-full border border-red-500/20 active:scale-95 transition-transform font-bold"
                  >
                    Empty Trash
                  </button>
                )}
              </div>
            )}
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setViewMode('list')}
                className={cn("p-2 rounded-full transition-colors", viewMode === 'list' ? "bg-primary/20 text-primary" : "text-text-main bg-card-bg")}
              >
                <List className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setViewMode('grid')}
                className={cn("p-2 rounded-full transition-colors", viewMode === 'grid' ? "bg-primary/20 text-primary" : "text-text-main bg-card-bg")}
              >
                <Grid className="w-5 h-5" />
              </button>
            </div>
          </div>

          {error && (
            <div className="mx-4 mb-4 bg-red-900/20 border border-red-500/50 p-3 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />
              <p className="text-sm text-red-200">{error}</p>
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <div className="px-4 flex flex-col gap-2">
              {displayFolders.map((folder) => (
                <div 
                  key={folder.id}
                  draggable={sidebarView !== 'trash'}
                  onDragStart={(e) => sidebarView !== 'trash' && handleDragStart(e, folder.id, 'folder')}
                  onDragOver={(e) => sidebarView !== 'trash' && handleDragOver(e, folder.id)}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(e) => sidebarView !== 'trash' && handleDrop(e, folder.id)}
                  onClick={() => handleOpenFolder(folder)}
                  className={cn(
                    "bg-card-bg rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors border-2 border-transparent active:opacity-50",
                    sidebarView !== 'trash' && "cursor-grab active:cursor-grabbing",
                    draggedItem?.id === folder.id && "opacity-40",
                    dragOverFolderId === folder.id && "border-primary bg-primary/10 shadow-lg scale-[1.02]"
                  )}
                >
                  <div className="flex items-center gap-3">
                    {folder.isLocked ? (
                      <Lock className="w-5 h-5 text-primary" />
                    ) : (
                      <Folder className="w-5 h-5" style={{ color: folder.color || 'var(--color-folder)' }} fill="currentColor" />
                    )}
                    <span className="text-sm font-medium text-text-main">{folder.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {sidebarView === 'trash' ? (
                      <>
                        <button onClick={(e) => handleRestore(e, 'folders', folder.id)} className="p-2 text-text-muted hover:text-primary"><RotateCcw className="w-4 h-4" /></button>
                        <button onClick={(e) => handlePermanentDelete(e, 'folders', folder.id)} className="p-2 text-text-muted hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setActiveFolderMenu(folder); }} className="p-2 text-text-muted hover:text-primary">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              
              {displayImages.map((image) => (
                <div 
                  key={image.id}
                  draggable={sidebarView !== 'trash'}
                  onDragStart={(e) => sidebarView !== 'trash' && handleDragStart(e, image.id, 'image')}
                  onClick={() => setPreviewImage(image.url || null)}
                  className={cn(
                    "bg-card-bg rounded-xl p-3 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors",
                    sidebarView !== 'trash' && "cursor-grab active:cursor-grabbing",
                    draggedItem?.id === image.id && "opacity-40"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <ImageIcon className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium text-text-main truncate max-w-[200px]">
                      {image.name || `Image_${image.id.slice(0,6)}.jpg`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted hidden sm:block">{new Date(image.createdAt).toLocaleDateString()}</span>
                    {sidebarView === 'trash' ? (
                      <>
                        <button onClick={(e) => handleRestore(e, 'images', image.id)} className="p-2 text-text-muted hover:text-primary"><RotateCcw className="w-4 h-4" /></button>
                        <button onClick={(e) => handlePermanentDelete(e, 'images', image.id)} className="p-2 text-text-muted hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                      </>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setActiveImageMenu(image); }} className="p-2 text-text-muted hover:text-primary"><MoreVertical className="w-4 h-4" /></button>
                    )}
                  </div>
                </div>
              ))}
              
              {displayFolders.length === 0 && displayImages.length === 0 && (
                <div className="py-12 text-center text-text-muted">
                  <p>No items found</p>
                </div>
              )}
            </div>
          )}

          {/* Grid View */}
          {viewMode === 'grid' && (
            <div className="px-4 grid grid-cols-2 gap-3">
              {/* Folders in Grid */}
              {displayFolders.map((folder) => (
                <div 
                  key={folder.id}
                  draggable={sidebarView !== 'trash'}
                  onDragStart={(e) => sidebarView !== 'trash' && handleDragStart(e, folder.id, 'folder')}
                  onDragOver={(e) => sidebarView !== 'trash' && handleDragOver(e, folder.id)}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(e) => sidebarView !== 'trash' && handleDrop(e, folder.id)}
                  onClick={() => handleOpenFolder(folder)}
                  className={cn(
                    "bg-card-bg rounded-2xl p-4 flex flex-col h-[140px] cursor-pointer active:scale-95 transition-all border-2 border-transparent",
                    sidebarView !== 'trash' && "cursor-grab active:cursor-grabbing",
                    draggedItem?.id === folder.id && "opacity-40",
                    dragOverFolderId === folder.id ? "border-primary bg-primary/10 shadow-lg scale-[1.05]" : "hover:bg-white/5"
                  )}
                >
                  <div className="flex items-start justify-between mb-auto">
                    <div className="flex items-center gap-2">
                      {folder.isLocked ? (
                        <Lock className="w-5 h-5 text-primary" />
                      ) : (
                        <Folder className="w-5 h-5" style={{ color: folder.color || 'var(--color-folder)' }} fill="currentColor" />
                      )}
                      <span className="text-sm font-medium text-text-main truncate max-w-[80px]">
                        {folder.name}
                      </span>
                    </div>
                    {sidebarView === 'trash' ? (
                      <div className="flex">
                        <button onClick={(e) => handleRestore(e, 'folders', folder.id)} className="text-text-muted p-1 hover:text-primary"><RotateCcw className="w-4 h-4" /></button>
                        <button onClick={(e) => handlePermanentDelete(e, 'folders', folder.id)} className="text-text-muted p-1 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setActiveFolderMenu(folder); }} className="text-text-muted p-1 hover:text-primary">
                        <MoreVertical className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                  <div className="flex justify-center items-center flex-1">
                    <Folder className="w-16 h-16 text-folder-graphic" fill="currentColor" />
                  </div>
                </div>
              ))}
              
              {/* Images in Grid */}
              {displayImages.map((image) => {
                const url = imageUrls[image.fileId] || image.url;
                return (
                  <div 
                    key={image.id}
                    draggable={sidebarView !== 'trash'}
                    onDragStart={(e) => sidebarView !== 'trash' && handleDragStart(e, image.id, 'image')}
                    onClick={() => setPreviewImage(url || null)}
                    className={cn(
                      "bg-card-bg rounded-2xl overflow-hidden flex flex-col h-[200px] cursor-pointer active:scale-[0.98] transition-all border border-border/50",
                      sidebarView !== 'trash' && "cursor-grab active:cursor-grabbing",
                      draggedItem?.id === image.id && "opacity-40 grayscale-[0.5]"
                    )}
                  >
                    {/* Header: Icon, Name, 3-dot */}
                    <div className="p-3 flex items-start justify-between">
                      <div className="flex items-center gap-2 overflow-hidden flex-1">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <ImageIcon className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-text-main truncate leading-tight">
                            {image.name || `Image_${image.id.slice(0,6)}.jpg`}
                          </span>
                          <span className="text-[10px] text-text-muted">
                            {new Date(image.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      
                      {sidebarView !== 'trash' && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); setActiveImageMenu(image); }} 
                          className="text-text-muted p-1.5 hover:bg-white/10 rounded-full active:scale-90 transition-all ml-1"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                    
                    {/* Image Preview Area */}
                    <div className="flex-1 bg-search-bg/40 relative mx-3 mb-3 rounded-xl overflow-hidden border border-border/30">
                      {url ? (
                        <img 
                          src={url} 
                          alt="Content" 
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
                        </div>
                      )}
                    </div>

                    {/* Trash view actions */}
                    {sidebarView === 'trash' && (
                      <div className="px-3 pb-3 flex justify-end gap-1">
                        <button onClick={(e) => handleRestore(e, 'images', image.id)} className="bg-white/5 p-2 rounded-lg text-text-muted hover:text-primary active:scale-90 transition-all"><RotateCcw className="w-4 h-4" /></button>
                        <button onClick={(e) => handlePermanentDelete(e, 'images', image.id)} className="bg-white/5 p-2 rounded-lg text-text-muted hover:text-red-400 active:scale-90 transition-all"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                );
              })}
              
              {displayFolders.length === 0 && displayImages.length === 0 && (
                <div className="col-span-2 py-12 text-center text-text-muted">
                  <p>No items found</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* FAB Overlay */}
        {isFabMenuOpen && (
          <div 
            className="absolute inset-0 bg-black/60 z-40 transition-opacity"
            onClick={() => setIsFabMenuOpen(false)}
          />
        )}

        {/* Floating Action Buttons */}
        {sidebarView === 'drive' && (
          <div className="absolute bottom-24 right-4 flex flex-col items-end gap-3 z-50">
            {isFabMenuOpen && (
              <div className="flex flex-col items-end gap-3 mb-2 animate-in slide-in-from-bottom-4">
                <a href="https://docs.google.com/presentation/create" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 bg-[#4a2824] text-[#ffdad5] px-5 py-3.5 rounded-2xl shadow-lg hover:bg-[#5c332e] transition-colors">
                  <MonitorPlay className="w-5 h-5" />
                  <span className="font-medium">Google Slides</span>
                </a>
                <a href="https://docs.google.com/spreadsheets/create" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 bg-[#4a2824] text-[#ffdad5] px-5 py-3.5 rounded-2xl shadow-lg hover:bg-[#5c332e] transition-colors">
                  <Table className="w-5 h-5" />
                  <span className="font-medium">Google Sheets</span>
                </a>
                <a href="https://docs.google.com/document/create" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 bg-[#4a2824] text-[#ffdad5] px-5 py-3.5 rounded-2xl shadow-lg hover:bg-[#5c332e] transition-colors">
                  <FileText className="w-5 h-5" />
                  <span className="font-medium">Google Docs</span>
                </a>
                
                <div className="relative">
                  <input
                    type="file"
                    id="scan-upload"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => { setIsFabMenuOpen(false); handleFileUpload(e); }}
                    disabled={isUploading}
                  />
                  <label htmlFor="scan-upload" className="flex items-center gap-4 bg-[#4a2824] text-[#ffdad5] px-5 py-3.5 rounded-2xl shadow-lg hover:bg-[#5c332e] transition-colors cursor-pointer">
                    <Camera className="w-5 h-5" />
                    <span className="font-medium">Scan</span>
                  </label>
                </div>

                <div className="relative">
                  <input
                    type="file"
                    id="fab-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { setIsFabMenuOpen(false); handleFileUpload(e); }}
                    disabled={isUploading}
                  />
                  <label htmlFor="fab-upload" className="flex items-center gap-4 bg-[#4a2824] text-[#ffdad5] px-5 py-3.5 rounded-2xl shadow-lg hover:bg-[#5c332e] transition-colors cursor-pointer">
                    <Upload className="w-5 h-5" />
                    <span className="font-medium">Upload</span>
                  </label>
                </div>

                <button 
                  onClick={() => { setIsFabMenuOpen(false); setNewFolderName('Untitled folder'); setIsCreatingFolder(true); }}
                  className="flex items-center gap-4 bg-[#4a2824] text-[#ffdad5] px-5 py-3.5 rounded-2xl shadow-lg hover:bg-[#5c332e] transition-colors"
                >
                  <Folder className="w-5 h-5" />
                  <span className="font-medium">Folder</span>
                </button>
              </div>
            )}

            <button 
              onClick={() => setIsFabMenuOpen(!isFabMenuOpen)}
              className={cn(
                "w-16 h-16 rounded-[20px] flex items-center justify-center shadow-lg transition-all active:scale-95",
                isFabMenuOpen ? "bg-[#ffb4ab] text-[#690005]" : "bg-primary text-[#ffdad5]"
              )}
            >
              {isUploading && !isFabMenuOpen ? (
                <div className="w-6 h-6 border-2 border-[#ffdad5] border-t-transparent rounded-full animate-spin" />
              ) : isFabMenuOpen ? (
                <X className="w-8 h-8" />
              ) : (
                <Plus className="w-8 h-8" />
              )}
            </button>
          </div>
        )}

        {/* Storage Modal */}
      {isStorageModalOpen && (
        <div className="fixed inset-0 z-[300] bg-app-bg flex flex-col p-6 items-center justify-center animate-in fade-in">
          <div className="w-full max-w-sm bg-card-bg rounded-3xl p-6 shadow-2xl">
            <h2 className="text-xl font-bold mb-6">Storage Overview</h2>
            <div className="h-[200px] w-full flex items-center justify-center">
              <PieChart width={200} height={200}>
                <Pie
                  data={[
                    { name: 'Folders', value: folders.length },
                    { name: 'Images', value: images.length }
                  ]}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  <Cell fill="#f59e0b" />
                  <Cell fill="#3b82f6" />
                </Pie>
              </PieChart>
            </div>
            <div className="space-y-4">
              <p>Total Folders: {folders.length}</p>
              <p>Total Images: {images.length}</p>
              <p>Total Size: {((folders.reduce((acc, f) => acc + (f.size || 0), 0) + images.reduce((acc, i) => acc + (i.size || 0), 0)) / (1024 * 1024)).toFixed(1)} MB</p>
            </div>
            <button onClick={() => setIsStorageModalOpen(false)} className="w-full mt-8 py-3 rounded-full bg-primary text-white font-bold">Close</button>
          </div>
        </div>
      )}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-app-bg border-t border-border flex items-center justify-around px-2 pb-2">
          <button 
            onClick={() => { setActiveTab('home'); setSidebarView('drive'); setSelectedFolderId(null); }}
            className="flex flex-col items-center gap-1 p-2 min-w-[64px]"
          >
            <div className={cn("px-4 py-1 rounded-full transition-colors", activeTab === 'home' && sidebarView === 'drive' ? "bg-primary-light" : "")}>
              <Home className={cn("w-6 h-6", activeTab === 'home' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")} />
            </div>
            <span className={cn("text-[11px] font-medium", activeTab === 'home' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")}>Home</span>
          </button>
          
          <button 
            onClick={() => { setActiveTab('starred'); setSidebarView('drive'); }}
            className="flex flex-col items-center gap-1 p-2 min-w-[64px]"
          >
            <div className={cn("px-4 py-1 rounded-full transition-colors", activeTab === 'starred' && sidebarView === 'drive' ? "bg-primary-light" : "")}>
              <Star className={cn("w-6 h-6", activeTab === 'starred' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")} />
            </div>
            <span className={cn("text-[11px] font-medium", activeTab === 'starred' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")}>Starred</span>
          </button>
          
          <button 
            onClick={() => { setActiveTab('shared'); setSidebarView('drive'); }}
            className="flex flex-col items-center gap-1 p-2 min-w-[64px]"
          >
            <div className={cn("px-4 py-1 rounded-full transition-colors", activeTab === 'shared' && sidebarView === 'drive' ? "bg-primary-light" : "")}>
              <Users className={cn("w-6 h-6", activeTab === 'shared' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")} />
            </div>
            <span className={cn("text-[11px] font-medium", activeTab === 'shared' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")}>Shared</span>
          </button>
          
          <button 
            onClick={() => { setActiveTab('files'); setSidebarView('drive'); setSelectedFolderId(null); }}
            className="flex flex-col items-center gap-1 p-2 min-w-[64px]"
          >
            <div className={cn("px-4 py-1 rounded-full transition-colors", activeTab === 'files' && sidebarView === 'drive' ? "bg-primary-light" : "")}>
              <Folder className={cn("w-6 h-6", activeTab === 'files' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")} />
            </div>
            <span className={cn("text-[11px] font-medium", activeTab === 'files' && sidebarView === 'drive' ? "text-text-main" : "text-text-muted")}>Files</span>
          </button>
        </div>

      </main>

      {/* New Folder Modal */}
      {isCreatingFolder && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card-bg w-full max-w-[320px] rounded-3xl p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-medium text-text-main mb-4">New folder</h3>
            <form onSubmit={handleCreateFolder}>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full bg-transparent border border-primary text-text-main px-3 py-3 rounded-lg outline-none text-base mb-6 focus:ring-1 focus:ring-primary"
                autoFocus
                onFocus={(e) => e.target.select()}
              />
              <div className="mb-6">
                <label className="text-xs text-text-muted mb-2 block uppercase font-medium">Folder Color</label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {['#8c4a43', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setSelectedFolderColor(color)}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-all",
                        selectedFolderColor === color ? "border-white scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <input
                  type="text"
                  value={selectedFolderColor}
                  onChange={(e) => setSelectedFolderColor(e.target.value)}
                  placeholder="#HexCode"
                  className="w-full bg-transparent border border-border text-text-main px-3 py-2 rounded-lg text-sm outline-none font-mono"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsCreatingFolder(false)}
                  className="text-sm font-medium text-primary hover:bg-primary/10 px-4 py-2 rounded-full transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="text-sm font-medium text-primary hover:bg-primary/10 px-4 py-2 rounded-full transition-colors"
                  disabled={!newFolderName.trim()}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Folder Menu Modal */}
      {activeFolderMenu && (
        <>
          <div 
            className="fixed inset-0 z-[110] bg-black/60 transition-opacity"
            onClick={() => setActiveFolderMenu(null)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[120] bg-card-bg rounded-t-3xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom-full pb-6">
            <div className="w-12 h-1 bg-border rounded-full mx-auto my-4" />
            <div className="px-6 pb-4 border-b border-border/50">
              <h3 className="text-lg font-medium text-text-main flex items-center gap-3">
                <Folder className="w-6 h-6 text-folder" fill="currentColor" />
                <span className="truncate">{activeFolderMenu.name}</span>
              </h3>
            </div>
            <div className="py-2">
              <button onClick={() => { setActiveFolderMenu(null); alert("Share functionality coming soon"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Users className="w-5 h-5" />
                <span className="font-medium text-sm">Share</span>
              </button>
              <button 
                onClick={() => handleToggleFolderStar(activeFolderMenu)} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Star className={cn("w-5 h-5", activeFolderMenu.isStarred && "text-yellow-400 fill-current")} />
                <span className="font-medium text-sm">{activeFolderMenu.isStarred ? 'Remove from starred' : 'Add to starred'}</span>
              </button>
              
              <button 
                onClick={() => handleToggleFolderLock(activeFolderMenu)} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Lock className={cn("w-5 h-5", activeFolderMenu.isLocked && "text-primary fill-current")} />
                <span className="font-medium text-sm">{activeFolderMenu.isLocked ? 'Unlock folder' : 'Lock folder'}</span>
              </button>
              <button onClick={() => { setActiveFolderMenu(null); alert("Copied to clipboard!"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Link className="w-5 h-5" />
                <span className="font-medium text-sm">Copy link</span>
              </button>
              
              <div className="h-px bg-border/50 my-2 mx-6" />

              <button 
                onClick={() => {
                   setRenameFolderName(activeFolderMenu.name);
                   setIsRenamingFolder(true);
                   setActiveFolderMenu(null);
                }} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Edit2 className="w-5 h-5" />
                <span className="font-medium text-sm">Rename</span>
              </button>
              <div className="px-6 py-2">
                <p className="text-xs font-semibold text-text-muted uppercase mb-2 text-left">Folder Color</p>
                <div className="flex gap-2 flex-wrap">
                  {['#8c4a43', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={async () => {
                        await updateDoc(doc(db, 'folders', activeFolderMenu.id), { color });
                        setActiveFolderMenu(null);
                      }}
                      className={cn(
                        "w-7 h-7 rounded-full border-2",
                        activeFolderMenu.color === color ? "border-white scale-110" : "border-transparent"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              <button onClick={() => { setActiveFolderMenu(null); alert("Shortcuts coming soon"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <CornerUpRight className="w-5 h-5" />
                <span className="font-medium text-sm">Add shortcut</span>
              </button>
              <button 
                onClick={() => {
                  setMovingItem({ id: activeFolderMenu.id, type: 'folder', currentParentId: activeFolderMenu.parentId || 'root' });
                  setActiveFolderMenu(null);
                }} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <FolderOutput className="w-5 h-5" />
                <span className="font-medium text-sm">Move</span>
              </button>
              <button onClick={() => { setActiveFolderMenu(null); alert("Information coming soon"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Info className="w-5 h-5" />
                <span className="font-medium text-sm">View information</span>
              </button>
              
              <div className="h-px bg-border/50 my-2 mx-6" />

              <button 
                onClick={(e) => {
                  setActiveFolderMenu(null);
                  handleSoftDelete(e as any, 'folders', activeFolderMenu.id);
                }} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Trash2 className="w-5 h-5" />
                <span className="font-medium text-sm">Move to trash</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Rename Folder Modal */}
      {isRenamingFolder && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card-bg w-full max-w-[320px] rounded-3xl p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-medium text-text-main mb-4">Rename folder</h3>
            <form onSubmit={handleRenameFolder}>
              <input
                type="text"
                value={renameFolderName}
                onChange={(e) => setRenameFolderName(e.target.value)}
                className="w-full bg-transparent border border-primary text-text-main px-3 py-3 rounded-lg outline-none text-base mb-6 focus:ring-1 focus:ring-primary"
                autoFocus
                onFocus={(e) => e.target.select()}
              />
              <div className="flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsRenamingFolder(false)}
                  className="text-sm font-medium text-primary hover:bg-primary/10 px-4 py-2 rounded-full transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="text-sm font-medium text-primary hover:bg-primary/10 px-4 py-2 rounded-full transition-colors"
                  disabled={!renameFolderName.trim()}
                >
                  Ok
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Menu Modal */}
      {activeImageMenu && (
        <>
          <div 
            className="fixed inset-0 z-[110] bg-black/60 transition-opacity"
            onClick={() => setActiveImageMenu(null)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[120] bg-card-bg rounded-t-3xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom-full pb-6">
            <div className="w-12 h-1 bg-border rounded-full mx-auto my-4" />
            <div className="px-6 pb-4 border-b border-border/50">
              <h3 className="text-lg font-medium text-text-main flex items-center gap-3">
                <ImageIcon className="w-6 h-6 text-primary" />
                <span className="truncate">{activeImageMenu.name || `Image_${activeImageMenu.id.slice(0,6)}.jpg`}</span>
              </h3>
            </div>
            <div className="py-2">
              <button onClick={() => { setActiveImageMenu(null); alert("Share functionality coming soon"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Users className="w-5 h-5" />
                <span className="font-medium text-sm">Share</span>
              </button>
              <button 
                onClick={() => handleToggleImageStar(activeImageMenu)} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Star className={cn("w-5 h-5", activeImageMenu.isStarred && "text-yellow-400 fill-current")} />
                <span className="font-medium text-sm">{activeImageMenu.isStarred ? 'Remove from starred' : 'Add to starred'}</span>
              </button>
              <button 
                onClick={async () => {
                  if (!db) return;
                  try {
                    await updateDoc(doc(db, 'images', activeImageMenu.id), { isOffline: !activeImageMenu.isOffline });
                    setActiveImageMenu(null);
                  } catch (err) {
                    console.error("Failed to make offline", err);
                  }
                }} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <CheckCircle className={cn("w-5 h-5", activeImageMenu.isOffline && "text-primary")} />
                <span className="font-medium text-sm">{activeImageMenu.isOffline ? 'Remove from offline' : 'Make available offline'}</span>
              </button>
              <div className="h-px bg-border/50 my-2 mx-6" />

               <button onClick={() => { setActiveImageMenu(null); alert("Copied to clipboard!"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Link className="w-5 h-5" />
                <span className="font-medium text-sm">Copy link</span>
              </button>
              <button onClick={() => { handleMakeCopy(activeImageMenu); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Copy className="w-5 h-5" />
                <span className="font-medium text-sm">Make a copy</span>
              </button>
              <button onClick={() => { setActiveImageMenu(null); alert("Send a copy coming soon"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Share2 className="w-5 h-5" />
                <span className="font-medium text-sm">Send a copy</span>
              </button>

              <div className="h-px bg-border/50 my-2 mx-6" />

              <button 
                onClick={() => handleDownloadImage(activeImageMenu)} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Download className="w-5 h-5" />
                <span className="font-medium text-sm">Download</span>
              </button>
              <button 
                onClick={() => {
                   let defaultName = activeImageMenu.name || `Image_${activeImageMenu.id.slice(0,6)}.jpg`;
                   setRenameImageName(defaultName);
                   setIsRenamingImage(true);
                   setActiveImageMenu(null);
                }} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Edit2 className="w-5 h-5" />
                <span className="font-medium text-sm">Rename</span>
              </button>
              <button onClick={() => { setActiveImageMenu(null); alert("Shortcuts coming soon"); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <CornerUpRight className="w-5 h-5" />
                <span className="font-medium text-sm">Add shortcut</span>
              </button>
              <button onClick={() => { setMovingItem({ id: activeImageMenu.id, type: 'image', currentParentId: activeImageMenu.folderId }); setActiveImageMenu(null); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <FolderOutput className="w-5 h-5" />
                <span className="font-medium text-sm">Move</span>
              </button>

              <div className="h-px bg-border/50 my-2 mx-6" />

              <button onClick={() => { setImageInfoModal(activeImageMenu); setActiveImageMenu(null); }} className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors">
                <Info className="w-5 h-5" />
                <span className="font-medium text-sm">View information</span>
              </button>

              <div className="h-px bg-border/50 my-2 mx-6" />

              <button 
                onClick={(e) => {
                  setActiveImageMenu(null);
                  handleSoftDelete(e as any, 'images', activeImageMenu.id);
                }} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-text-main transition-colors"
              >
                <Trash2 className="w-5 h-5" />
                <span className="font-medium text-sm">Move to trash</span>
              </button>
              
              <button 
                onClick={() => {
                  setDeleteChannelConfirm(activeImageMenu);
                  setActiveImageMenu(null);
                }} 
                className="w-full flex items-center gap-4 px-6 py-3 hover:bg-white/5 text-red-500 transition-colors"
              >
                <AlertOctagon className="w-5 h-5" />
                <span className="font-medium text-sm">Delete from channel</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Rename Image Modal */}
      {isRenamingImage && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card-bg w-full max-w-[320px] rounded-3xl p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-medium text-text-main mb-4">Rename item</h3>
            <form onSubmit={handleRenameImage}>
              <input
                type="text"
                value={renameImageName}
                onChange={(e) => setRenameImageName(e.target.value)}
                className="w-full bg-transparent border border-primary text-text-main px-3 py-3 rounded-lg outline-none text-base mb-6 focus:ring-1 focus:ring-primary"
                autoFocus
                onFocus={(e) => {
                  const val = e.target.value;
                  const dotIndex = val.lastIndexOf('.');
                  if (dotIndex > 0) {
                    e.target.setSelectionRange(0, dotIndex);
                  } else {
                    e.target.select();
                  }
                }}
              />
              <div className="flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsRenamingImage(false)}
                  className="text-sm font-medium text-primary hover:bg-primary/10 px-4 py-2 rounded-full transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="text-sm font-medium text-primary hover:bg-primary/10 px-4 py-2 rounded-full transition-colors"
                  disabled={!renameImageName.trim()}
                >
                  Ok
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move to Folder Modal */}
      {movingItem && (
        <div className="fixed inset-0 z-[150] bg-app-bg flex flex-col animate-in slide-in-from-bottom">
          <div className="flex items-center gap-6 p-4 border-b border-border/50 sticky top-0 bg-card-bg/90 backdrop-blur z-10">
            <button onClick={() => setMovingItem(null)} className="text-text-main hover:bg-white/5 rounded-full p-2 -ml-2">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-medium text-text-main truncate">
              Move {movingItem.type} to...
            </h1>
          </div>
          
          <div className="flex-1 overflow-y-auto bg-app-bg">
            <div className="p-4 space-y-2">
              <div className="text-xs font-semibold text-text-muted px-2 py-1 uppercase tracking-wider">Suggested</div>
              <button 
                onClick={() => handleMoveImage('root')}
                disabled={movingItem.currentParentId === 'root'}
                className={cn(
                  "w-full flex items-center gap-4 p-4 hover:bg-white/5 rounded-2xl transition-colors group",
                  movingItem.currentParentId === 'root' && "opacity-50 grayscale pointer-events-none"
                )}
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-text-main">My Drive</p>
                  {movingItem.currentParentId === 'root' && <p className="text-[10px] text-primary italic">Currently here</p>}
                </div>
              </button>

              <div className="h-px bg-border/50 my-4" />
              <div className="text-xs font-semibold text-text-muted px-2 py-1 uppercase tracking-wider">Folders</div>
              
              {activeFolders.map(folder => (
                <button 
                  key={folder.id}
                  onClick={() => handleMoveImage(folder.id)}
                  disabled={folder.id === movingItem.currentParentId || (movingItem.type === 'folder' && folder.id === movingItem.id)}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 hover:bg-white/5 rounded-2xl transition-colors group",
                    (folder.id === movingItem.currentParentId || (movingItem.type === 'folder' && folder.id === movingItem.id)) && "opacity-50 grayscale pointer-events-none"
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-folder/10 flex items-center justify-center text-folder group-hover:scale-110 transition-transform">
                    <Folder className="w-5 h-5" fill="currentColor" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium text-text-main">{folder.name}</p>
                    {folder.id === movingItem.currentParentId && <p className="text-[10px] text-primary italic">Currently here</p>}
                  </div>
                  {(folder.id === movingItem.currentParentId || (movingItem.type === 'folder' && folder.id === movingItem.id)) && (
                    <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">Unavailable</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          
          <div className="p-4 border-t border-border bg-card-bg/90 backdrop-blur sticky bottom-0">
             <button 
                onClick={() => setMovingItem(null)}
                className="w-full bg-search-bg text-text-main py-4 rounded-2xl font-bold active:scale-95 transition-transform"
              >
                Cancel
              </button>
          </div>
        </div>
      )}

      {/* Delete from Channel Confirm Modal */}
      {deleteChannelConfirm && (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card-bg w-full max-w-[320px] rounded-3xl p-6 shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-medium text-text-main mb-2">Delete permanently?</h3>
            <p className="text-text-muted text-sm mb-6">
              This will permanently delete the file from the Telegram channel and it cannot be recovered.
            </p>
            <div className="flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => setDeleteChannelConfirm(null)}
                className="text-sm font-medium text-primary hover:bg-primary/10 px-4 py-2 rounded-full transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button"
                onClick={handleDeleteFromChannel}
                className="text-sm font-medium text-red-500 hover:bg-red-500/10 px-4 py-2 rounded-full transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Info Modal */}
      {imageInfoModal && (
        <div className="fixed inset-0 z-[130] bg-app-bg flex flex-col animate-in slide-in-from-right">
          <div className="flex flex-col h-full bg-card-bg overflow-y-auto">
            {/* Header */}
            <div className="flex items-center gap-6 p-4 border-b border-border/50 sticky top-0 bg-card-bg/90 backdrop-blur z-10">
              <button onClick={() => setImageInfoModal(null)} className="text-text-main hover:bg-white/5 rounded-full p-2 -ml-2">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-lg font-medium text-text-main truncate">
                {imageInfoModal.name || `Image_${imageInfoModal.id.slice(0,6)}.jpg`}
              </h1>
            </div>
            
            {/* Image Preview */}
            <div className="p-4 bg-app-bg flex justify-center">
              {imageInfoModal.url ? (
                <img 
                  src={imageInfoModal.url} 
                  alt="Preview" 
                  className="max-h-[300px] object-contain rounded-lg" 
                />
              ) : (
                <div className="w-full h-[200px] bg-search-bg rounded-lg animate-pulse" />
              )}
            </div>

            {/* Details */}
            <div className="p-6 space-y-6">
              <div>
                <p className="text-sm text-text-muted mb-1">Type</p>
                <p className="text-base text-text-main font-medium">Image</p>
              </div>
              
              <div>
                <p className="text-sm text-text-muted mb-1">Location</p>
                <div className="flex items-center gap-2">
                  <Folder className="w-4 h-4 text-folder object-fill" fill="currentColor"/>
                  <p className="text-base text-text-main font-medium">
                    {imageInfoModal.folderId === 'root' ? 'My Drive' : folders.find(f => f.id === imageInfoModal.folderId)?.name || 'Unknown'}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-text-muted mb-1">Size</p>
                  <p className="text-base text-text-main font-medium">
                    {imageInfoModal.size ? (imageInfoModal.size / (1024 * 1024)).toFixed(1) + ' MB' : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-text-muted mb-1">Storage used</p>
                  <p className="text-base text-text-main font-medium">
                    {imageInfoModal.size ? (imageInfoModal.size / (1024 * 1024)).toFixed(1) + ' MB' : '-'}
                  </p>
                </div>
              </div>
              
              <div>
                <p className="text-sm text-text-muted mb-1">Created</p>
                <p className="text-base text-text-main font-medium">
                  {new Date(imageInfoModal.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              
              <div>
                <p className="text-sm text-text-muted mb-1">Modified</p>
                <p className="text-base text-text-main font-medium">
                  {new Date(imageInfoModal.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} by {user?.displayName || 'Unknown'}
                </p>
              </div>

              <div className="h-px bg-border/50" />

              <div>
                <h3 className="text-base font-medium text-text-main mb-4">Activity</h3>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white font-medium shrink-0">
                    {user?.displayName?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <p className="text-base text-text-main font-medium">{user?.displayName || 'Unknown User'}</p>
                      <p className="text-sm text-text-muted">
                        {new Date(imageInfoModal.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                    <p className="text-sm text-text-muted">Uploaded this file</p>
                  </div>
                </div>
                <p className="text-sm text-text-muted mt-6 pb-6">
                  No recorded activity before {new Date(imageInfoModal.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[200] bg-app-bg flex flex-col overflow-y-auto animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-6 p-4 sticky top-0 bg-card-bg/90 backdrop-blur z-10 border-b border-border/50">
            <button onClick={() => setIsSettingsOpen(false)} className="text-text-main hover:bg-white/5 rounded-full p-2 -ml-2">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-[22px] font-normal text-text-main">Settings</h1>
          </div>
          
          <div className="p-4 bg-primary/5 mx-4 mt-6 rounded-2xl border border-primary/20">
            <button 
              onClick={() => { setSelectedFolderId(null); setSidebarView('drive'); setIsSettingsOpen(false); }}
              className="flex items-center gap-3 w-full"
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <HardDrive className="w-5 h-5" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-text-main">Manage storage</p>
                <p className="text-xs text-text-muted">View all folders and files</p>
              </div>
              <ArrowLeft className="w-5 h-5 text-text-muted rotate-180" />
            </button>
          </div>

          <div className="flex flex-col mt-6 px-5 space-y-8 pb-10">
            {/* Security Section */}
            <section>
              <h2 className="text-[14px] font-semibold text-primary uppercase tracking-wider mb-4">Security</h2>
              <div 
                onClick={() => setShowPasscodeSetup(true)}
                className="cursor-pointer hover:bg-white/5 py-3 flex items-center justify-between group"
              >
                <div>
                  <div className="text-[16px] text-text-main group-hover:text-primary transition-colors">Folder Lock Passcode</div>
                  <div className="text-[14px] text-text-muted mt-1">{settings.passcode ? 'Passcode is set' : 'Not set'}</div>
                </div>
                <Lock className={cn("w-5 h-5", settings.passcode ? "text-primary" : "text-text-muted")} />
              </div>
            </section>

            {/* Theme Section */}
            <section>
              <h2 className="text-[14px] font-semibold text-primary uppercase tracking-wider mb-4">Appearance</h2>
              <div className="space-y-4">
                <div className="text-[16px] text-text-main mb-2">Theme</div>
                <div className="grid grid-cols-3 gap-2">
                  {['system', 'light', 'dark'].map((t) => (
                    <button
                      key={t}
                      onClick={() => updateSettings({ theme: t as any })}
                      className={cn(
                        "py-2 px-3 rounded-xl border text-sm font-medium transition-all capitalize",
                        settings.theme === t 
                          ? "bg-primary border-primary text-white shadow-lg shadow-primary/20" 
                          : "border-border text-text-muted hover:border-primary/50"
                      )}
                    >
                      {t === 'light' ? 'Day' : t === 'dark' ? 'Night' : 'System'}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Data Usage Section */}
            <section>
              <h2 className="text-[14px] font-semibold text-primary uppercase tracking-wider mb-4">Data usage</h2>
              <div 
                onClick={() => updateSettings({ transferOverWifiOnly: !settings.transferOverWifiOnly })}
                className="flex items-center justify-between cursor-pointer hover:bg-white/5 py-2 group"
              >
                <div className="pr-4">
                  <div className="text-[16px] text-text-main group-hover:text-primary transition-colors">Transfer files only over Wi-Fi</div>
                  <div className="text-[14px] text-text-muted mt-1 leading-snug">
                    {settings.transferOverWifiOnly 
                      ? 'Uploading only over Wi-Fi' 
                      : 'Uploading over both Wi-Fi and Mobile Data'}
                  </div>
                </div>
                <div className="shrink-0">
                  <div className={cn(
                    "w-12 h-6 rounded-full flex items-center px-1 transition-colors duration-200",
                    settings.transferOverWifiOnly ? "bg-primary" : "bg-border"
                  )}>
                    <div className={cn(
                      "w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm",
                      settings.transferOverWifiOnly ? "translate-x-6" : "translate-x-0"
                    )} />
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Passcode Prompt Modal */}
      {passcodeModal && (
        <div className="fixed inset-0 z-[300] bg-app-bg/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
          <div className="bg-card-bg w-full max-w-[320px] rounded-[32px] p-8 flex flex-col items-center shadow-2xl border border-white/5">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center text-primary mb-5">
              <Lock className={cn("w-6 h-6", passcodeError && "animate-bounce text-red-500")} />
            </div>
            <h2 className="text-lg font-semibold text-text-main mb-1">
              {passcodeModal.type === 'unlock_toggle' ? 'Verify Identity' : 'Locked Folder'}
            </h2>
            <p className="text-sm text-text-muted mb-8 text-center px-4">
              {passcodeModal.type === 'unlock_toggle' ? 'Enter passcode to remove lock' : 'Enter passcode to unlock this folder'}
            </p>
            
            <div className="flex gap-4 mb-10">
              {[0, 1, 2, 3].map((i) => (
                <div 
                  key={i}
                  className={cn(
                    "w-3.5 h-3.5 rounded-full border-2 border-primary transition-all duration-200",
                    passcodeInput.length > i ? "bg-primary scale-110" : "bg-transparent",
                    passcodeError && "border-red-500 bg-red-500 scale-110"
                  )}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-x-8 gap-y-4 mb-8">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  disabled={passcodeError}
                  onClick={() => passcodeInput.length < 4 && setPasscodeInput(prev => prev + num)}
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-medium hover:bg-white/5 active:scale-90 transition-all text-text-main"
                >
                  {num}
                </button>
              ))}
              <div />
              <button
                disabled={passcodeError}
                onClick={() => passcodeInput.length < 4 && setPasscodeInput(prev => prev + '0')}
                className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-medium hover:bg-white/5 active:scale-90 transition-all text-text-main"
              >
                0
              </button>
              <button 
                onClick={() => setPasscodeInput(prev => prev.slice(0, -1))}
                className="w-12 h-12 rounded-full flex items-center justify-center hover:bg-white/5 text-text-muted"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-3 w-full">
              <button
                onClick={() => { setPasscodeModal(null); setPasscodeInput(''); setPasscodeError(false); }}
                className="flex-1 py-3 text-sm font-medium text-text-muted hover:bg-white/5 rounded-2xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={verifyPasscode}
                disabled={passcodeInput.length < 4 || passcodeError}
                className="flex-1 bg-primary text-white py-3 rounded-2xl text-sm font-bold disabled:opacity-50 active:scale-95 transition-all shadow-lg shadow-primary/20"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Passcode Setup Modal */}
      {showPasscodeSetup && (
        <div className="fixed inset-0 z-[300] bg-app-bg flex flex-col p-6 animate-in slide-in-from-right">
          <div className="flex items-center gap-6 mb-8">
            <button onClick={() => { setShowPasscodeSetup(false); setOldPasscode(''); setNewPasscode(''); setConfirmPasscode(''); }} className="text-text-main hover:bg-white/5 p-2 rounded-full">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className="text-2xl font-semibold">Security Settings</h1>
          </div>
          
          <div className="max-w-[400px] mx-auto w-full space-y-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center text-primary mx-auto mb-4">
                <Lock className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold">{settings.passcode ? 'Change Passcode' : 'Set Passcode'}</h2>
              <p className="text-sm text-text-muted mt-2">Secure your sensitive folders with a secret code</p>
            </div>

            <div className="space-y-6">
              {settings.passcode && (
                <div>
                  <label className="text-sm font-medium text-text-muted mb-2 block">Current Passcode</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={oldPasscode}
                    onChange={(e) => setOldPasscode(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter existing passcode"
                    className="w-full bg-white/5 border border-border rounded-xl px-4 py-4 text-xl tracking-[0.5em] focus:border-primary outline-none transition-colors"
                    autoFocus
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">New Passcode</label>
                <input
                  type="password"
                  maxLength={6}
                  value={newPasscode}
                  onChange={(e) => setNewPasscode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter numbers only"
                  className="w-full bg-white/5 border border-border rounded-xl px-4 py-4 text-xl tracking-[0.5em] focus:border-primary outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-text-muted mb-2 block">Confirm Passcode</label>
                <input
                  type="password"
                  maxLength={6}
                  value={confirmPasscode}
                  onChange={(e) => setConfirmPasscode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Re-enter passcode"
                  className="w-full bg-white/5 border border-border rounded-xl px-4 py-4 text-xl tracking-[0.5em] focus:border-primary outline-none transition-colors"
                />
              </div>

              <button
                onClick={handleSetPasscode}
                disabled={newPasscode.length < 4 || newPasscode !== confirmPasscode || (settings.passcode && oldPasscode.length < 4)}
                className="w-full bg-primary text-white py-4 rounded-2xl font-bold disabled:opacity-50 active:scale-95 transition-all shadow-lg shadow-primary/20"
              >
                {settings.passcode ? 'Update Passcode' : 'Save Passcode'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
