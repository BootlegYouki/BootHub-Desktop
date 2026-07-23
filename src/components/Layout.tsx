import React from 'react';
import { IconSvg } from './IconSvg';
import {
  Link2,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Search,
  FolderPlus,
  Plus,
  X,
  Sun,
  Moon,
} from 'lucide-react';
import { TuiContainer } from '../components/TuiContainer';
import { TuiButton } from '../components/TuiButton';
import { ConflictModal } from '../components/ConflictModal';
import { TuiAlertModal } from '../components/TuiAlertModal';
import { TitleBar } from '../components/TitleBar';
import { ImagePreview } from '../components/ImagePreview';
import { PhotoPreviewModal } from '../components/PhotoPreviewModal';

import { LinksPage } from '../pages/LinksPage';
import { TextsPage } from '../pages/TextsPage';
import { PhotosPage } from '../pages/PhotosPage';
import { FilesPage } from '../pages/FilesPage';
import { useWorkspace, ACCENT_COLORS, AccentTheme, TabType } from '../contexts/WorkspaceContext';

export function Layout() {
  const {
    themeMode, handleSetThemeMode, accentTheme,
    searchQuery, setSearchQuery,
    activeTab, setActiveTab,
    activeFolderId, setActiveFolderId,
    handleCreateFolder,
    isPaired, deviceId, handlePairDevice, pairingCode, cancelPairing,
    syncStatus, handleManualSync, handleDisconnect,
    attachedFiles, setAttachedFiles,
    inputText, setInputText,
    handleTextareaKeyDown, handleSubmitItem, handleDirectAddFiles, handleInputPaste, textareaRef,
    conflictAlert, dialog, folderPrompt, setFolderPrompt, previewPhotoId, setPreviewPhotoId,
    contextMenu, setContextMenu, editPrompt, setEditPrompt,
    createFolderWithName, handleCopyText, handleCutSelected, handleCopyItem, handleCutItem,
    handleDownloadFile, handleDeleteItem, handleSaveEdit,
    handleDeleteSelected,
    items,
    selectedIds, setSelectedIds,
    clipboard,
    folders, normalItems,
    getFolderName,
    dragActive, handleDragEnter, handleDragOver, handleDragLeave, handleDrop,
    handleCardContextMenu, handleCardClick, handleCardDoubleClick
  } = useWorkspace();

  const getPrimaryForeground = (theme: AccentTheme, isDark: boolean) => {
    if (isDark) {
      return '#000000';
    } else {
      if (theme === 'classic' || theme === 'rose' || theme === 'cobalt' || theme === 'green') {
        return '#FFFFFF';
      }
      return '#000000';
    }
  };

  const isDark = themeMode === 'dark';
  const primaryColor = ACCENT_COLORS[accentTheme][isDark ? 'dark' : 'light'];
  const primaryForeground = getPrimaryForeground(accentTheme, isDark);

  const themeColors = isDark
    ? {
      background: '#18181B', // zinc-900
      foreground: '#FAFAFA',
      card: '#18181B',
      border: '#52525B', // zinc-600 (lighter, matches mobile contrast)
      muted: '#A1A1AA', // zinc-400
      primary: primaryColor,
      primaryForeground,
    }
    : {
      background: '#F4F4F5', // zinc-100
      foreground: '#09090B', // zinc-950
      card: '#F4F4F5',
      border: '#D4D4D8', // zinc-300 border
      muted: '#71717A', // zinc-500
      primary: primaryColor,
      primaryForeground,
    };

  const rootStyles = {
    '--color-background': themeColors.background,
    '--color-foreground': themeColors.foreground,
    '--color-card': themeColors.card,
    '--color-border': themeColors.border,
    '--color-muted': themeColors.muted,
    '--color-primary': themeColors.primary,
    '--color-primary-foreground': themeColors.primaryForeground,
    '--color-destructive': '#ef4444',
  } as React.CSSProperties;

  return (
    <div
      style={rootStyles}
      className="h-screen bg-background text-foreground flex flex-col font-mono antialiased overflow-hidden"
    >
      <TitleBar title="BootHub" />
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden min-h-0">
        {/* --- TOP NAV PANEL (covers the whole row) --- */}
        <nav className="shrink-0 select-none">
          <TuiContainer label="Nav" style={{ width: '100%' }}>
            <div className="flex items-center justify-between gap-6 py-1 select-none">
              {/* Logo / Brand & Theme Toggle */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="flex items-center gap-3">
                  <IconSvg className="w-8 h-8 text-primary shrink-0" />
                  <div>
                    <h1 className="text-sm md:text-base font-bold tracking-widest text-primary leading-none">BootHub</h1>
                    <p className="text-[10px] text-muted leading-none mt-1">by BootlegYouki</p>
                  </div>
                </div>
                <button
                  onClick={() => handleSetThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
                  className="w-9 h-9 flex items-center justify-center border-[1.5px] border-border hover:bg-primary/10 active:scale-95 cursor-pointer select-none shrink-0"
                  title="Toggle Theme Mode"
                >
                  {themeMode === 'dark' ? <Sun size={18} className="text-primary" /> : <Moon size={18} className="text-primary" />}
                </button>
              </div>

              {/* Search and New Folder */}
              <div className="flex-1 max-w-xl flex gap-4 items-center">
                <div className="flex-1 flex items-center border-[1.5px] border-border px-3 bg-card gap-2 h-9">
                  <Search size={14} className="text-muted" />
                  <input
                    type="text"
                    placeholder={`Search ${activeTab}s...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-transparent text-xs py-1 focus:outline-hidden font-mono text-foreground"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="cursor-pointer">
                      <X size={12} className="text-muted hover:text-foreground" />
                    </button>
                  )}
                </div>
                <button
                  onClick={handleCreateFolder}
                  className="border-[1.5px] border-primary text-primary px-4 h-9 flex items-center gap-2 hover:bg-primary/20 cursor-pointer text-xs font-bold active:scale-95 shrink-0"
                >
                  <FolderPlus size={14} />
                  <span>New Folder</span>
                </button>
              </div>
            </div>
          </TuiContainer>
        </nav>

        {/* --- LOWER CONTAINER (SIDEBAR + CONTENT STACK) --- */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* --- SIDEBAR --- */}
          <aside className="w-64 shrink-0 flex flex-col gap-4 min-h-0 select-none">
            {/* NAVIGATION TABS / LIBRARY */}
            <TuiContainer
              label="Library"
              style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
              contentStyle={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}
            >
              {(['link', 'text', 'photo', 'file'] as TabType[]).map((tab) => {
                const isActive = activeTab === tab;
                const iconMap = {
                  link: <Link2 size={16} />,
                  text: <FileText size={16} />,
                  photo: <ImageIcon size={16} />,
                  file: <Paperclip size={16} />,
                };
                return (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab);
                      setActiveFolderId(null);
                    }}
                    className={`w-full border-[1.5px] py-3 px-4 flex items-center gap-3 font-bold cursor-pointer text-xs select-none shrink-0 ${isActive
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-border text-foreground hover:bg-primary/10 hover:border-primary'
                      }`}
                  >
                    {iconMap[tab]}
                    <span className="capitalize">{tab}s</span>
                  </button>
                );
              })}
            </TuiContainer>

            {/* SYNC STATUS */}
            <div className="shrink-0">
              <TuiContainer
                label="Sync"
                noPadding={false}
                style={{ height: '145px' }}
                contentStyle={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
              >
                {isPaired ? (
                  <div className="flex flex-col gap-2 py-0.5">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 border-[1.5px] border-primary flex items-center justify-center font-bold text-xs text-primary bg-card">
                        P
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-sm truncate leading-tight">
                          {deviceId ? `Device: ${deviceId.slice(0, 5)}` : 'Paired Device'}
                        </h4>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <TuiButton
                        onPress={handleManualSync}
                        variant="accent"
                        disabled={syncStatus.isSyncing}
                        className="w-full !min-h-[32px] !py-1 text-xs"
                      >
                        {syncStatus.isSyncing ? 'Syncing...' : 'Sync Now'}
                      </TuiButton>
                      <TuiButton
                        onPress={handleDisconnect}
                        variant="destructive"
                        disabled={syncStatus.isSyncing}
                        className="w-full !min-h-[32px] !py-1 text-xs"
                      >
                        Disconnect
                      </TuiButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col justify-between h-full py-1">
                    <div className="flex-1 flex items-center justify-center px-2">
                      <p className="text-[11px] text-muted leading-normal text-center">
                        Offline. Pair with mobile to sync.
                      </p>
                    </div>
                    <TuiButton
                      onPress={handlePairDevice}
                      variant="outline"
                      className="w-full !min-h-[32px] !py-1 text-xs mt-auto"
                    >
                      Pair Device
                    </TuiButton>
                  </div>
                )}
              </TuiContainer>
            </div>
          </aside>

          {/* --- RIGHT CONTENT STACK (PATH + MAIN + FOOTER) --- */}
          <div className="flex-1 flex flex-col gap-3 min-h-0 min-w-0">
            {/* PATH HEADER CONTAINER */}
            <div className="shrink-0">
              <TuiContainer label="Path">
                <div className="flex items-center gap-2 text-xs font-bold py-0.5 select-none">
                  <button
                    onClick={() => setActiveFolderId(null)}
                    className={`hover:underline cursor-pointer ${activeFolderId ? 'text-primary' : 'text-foreground'}`}
                  >
                    {activeTab === 'link' ? 'Links' : activeTab === 'text' ? 'Texts' : activeTab === 'photo' ? 'Photos' : 'Files'}
                  </button>
                  {activeFolderId && (
                    <>
                      <span className="text-muted font-normal">&gt;</span>
                      <span className="text-foreground">
                        {(() => {
                          const f = items.find((x) => x.id === activeFolderId);
                          return f ? getFolderName(f) : 'Folder';
                        })()}
                      </span>
                    </>
                  )}
                </div>
              </TuiContainer>
            </div>

            {/* MAIN WORKSPACE */}
            <main className="flex-1 min-h-0 min-w-0 flex flex-col">
              {(() => {
                const pageProps = {
                  items,
                  folders,
                  normalItems,
                  activeFolderId,
                  setActiveFolderId,
                  selectedIds,
                  setSelectedIds,
                  clipboard,
                  contextMenuVisible: contextMenu.visible,
                  dragActive,
                  handleDragEnter,
                  handleDragOver,
                  handleDragLeave,
                  handleDrop,
                  handleCardContextMenu,
                  handleCardClick,
                  handleCardDoubleClick,
                  getFolderName,
                };
                return (
                  <>
                    {activeTab === 'link' && <LinksPage {...pageProps} />}
                    {activeTab === 'text' && <TextsPage {...pageProps} />}
                    {activeTab === 'photo' && <PhotosPage {...pageProps} />}
                    {activeTab === 'file' && <FilesPage {...pageProps} />}
                  </>
                );
              })()}
            </main>

            <footer className="shrink-0 select-none">
              <TuiContainer
                label="Input Console"
                style={{ width: '100%' }}
                contentStyle={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
              >
                <div className="flex flex-col gap-3">
                  <form onSubmit={handleSubmitItem} className="flex gap-4 w-full items-end">
                    <input
                      type="file"
                      id="attachment-input"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) {
                          handleDirectAddFiles(e.target.files);
                          e.target.value = '';
                        }
                      }}
                    />
                    <TuiButton
                      type="button"
                      onPress={() => document.getElementById('attachment-input')?.click()}
                      className="!w-auto px-4 !h-10 !min-h-[40px] flex items-center justify-center gap-2 shrink-0"
                      variant="outline"
                      title="Attach Photos/Files"
                    >
                      <Paperclip size={18} />
                      <span>File</span>
                    </TuiButton>

                    {/* Combined Staged File List + Input Wrapper */}
                    <div className={`flex-1 flex flex-col border-[1.5px] border-border bg-card px-3 gap-3 min-h-[40px] justify-center ${attachedFiles.length > 0 ? 'py-2.25' : 'py-2'}`}>
                      {/* Attachment Previews */}
                      {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-4 border-b border-border/30 pb-3">
                          {attachedFiles.map((file, index) => {
                            const isImage = file.type.startsWith('image/');
                            return (
                              <div key={index} className="relative border-[1.5px] border-border w-32 h-32 flex items-center justify-center bg-[#18181b] select-none">
                                {isImage ? (
                                  <ImagePreview file={file} />
                                ) : (
                                  <div className="flex flex-col items-center gap-1.5 px-2 text-center min-w-0">
                                    <span className="text-xs text-muted font-bold font-mono">
                                      [ {file.name.split('.').pop()?.toUpperCase() || 'FILE'} ]
                                    </span>
                                    <span className="text-[9px] text-muted/60 truncate max-w-full font-mono">
                                      {file.name}
                                    </span>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
                                  }}
                                  className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 hover:opacity-100 cursor-pointer focus:outline-hidden"
                                  title="Remove Attachment"
                                >
                                  <X size={24} className="text-white hover:scale-110 transition-transform duration-100" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <textarea
                        ref={textareaRef}
                        rows={1}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyDown={handleTextareaKeyDown}
                        onPaste={handleInputPaste}
                        placeholder="Enter link or text content here..."
                        className="w-full bg-transparent text-xs focus:outline-hidden font-mono text-foreground p-0.5 resize-none overflow-y-hidden"
                        style={{ height: 'auto', minHeight: '20px' }}
                      />
                    </div>

                    <TuiButton onPress={handleSubmitItem} className="!w-auto px-6 !h-10 !min-h-[40px]">
                      <Plus size={15} className="mr-1" />
                      <span>Add</span>
                    </TuiButton>
                  </form>
                  <p className="text-[9px] text-muted text-center leading-normal mt-0.5">
                    Tip: Drag & Drop files or Paste (Ctrl+V) directly inside the input console text box to stage attachments!
                  </p>
                </div>
              </TuiContainer>
            </footer>
          </div>
        </div>
        {/* SYNC CONFLICT MODAL */}
        <ConflictModal
          visible={conflictAlert.visible}
          title={conflictAlert.title}
          message={conflictAlert.message}
          options={conflictAlert.options}
        />

        {/* CUSTOM DIALOG ALERT/CONFIRM MODAL */}
        <TuiAlertModal
          visible={dialog.visible}
          title={dialog.title}
          message={dialog.message}
          type={dialog.type}
          confirmText={dialog.confirmText}
          cancelText={dialog.cancelText}
          isDestructive={dialog.isDestructive}
          onConfirm={dialog.onConfirm}
          onCancel={dialog.onCancel}
        />

        {/* CUSTOM FOLDER PROMPT MODAL */}
        {folderPrompt.visible && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 select-none animate-in fade-in duration-100">
            <div className="w-full max-w-sm">
              <TuiContainer label="New Folder" disableHover={true}>
                <div className="py-2 flex flex-col gap-4">
                  <p className="text-xs text-muted mb-1 font-mono">Enter folder name:</p>
                  <input
                    type="text"
                    value={folderPrompt.name}
                    onChange={(e) => setFolderPrompt({ ...folderPrompt, name: e.target.value })}
                    placeholder="Folder Name"
                    className="w-full border-[1.5px] border-border bg-card px-3 py-2 text-xs focus:outline-hidden font-mono text-foreground"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const name = folderPrompt.name.trim();
                        setFolderPrompt({ ...folderPrompt, visible: false });
                        if (name) createFolderWithName(name);
                      } else if (e.key === 'Escape') {
                        setFolderPrompt({ ...folderPrompt, visible: false });
                      }
                    }}
                  />
                  <div className="flex gap-4">
                    <TuiButton
                      onPress={() => setFolderPrompt({ ...folderPrompt, visible: false })}
                      variant="outline"
                    >
                      Cancel
                    </TuiButton>
                    <TuiButton
                      onPress={async () => {
                        const name = folderPrompt.name.trim();
                        setFolderPrompt({ ...folderPrompt, visible: false });
                        if (name) {
                          await createFolderWithName(name);
                        }
                      }}
                      variant="accent"
                    >
                      Create
                    </TuiButton>
                  </div>
                </div>
              </TuiContainer>
            </div>
          </div>
        )}

        {/* PHOTO PREVIEW OVERLAY MODAL */}
        {previewPhotoId && (
          <PhotoPreviewModal
            item={items.find(x => x.id === previewPhotoId)!}
            onClose={() => setPreviewPhotoId(null)}
            isContextMenuVisible={contextMenu.visible}
            onContextMenu={(e, item) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                item,
              });
            }}
          />
        )}

        {/* CUSTOM CONTEXT MENU */}
        {contextMenu.visible && (
          <div
            className="fixed inset-0 z-[99998] bg-transparent cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
          />
        )}
        {contextMenu.visible && contextMenu.item && (
          <div
            style={{
              position: 'fixed',
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              zIndex: 99999,
            }}
            className="bg-card border-[1.5px] border-border py-1 min-w-[150px] font-mono animate-in fade-in zoom-in-95 duration-100 select-none animate-duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedIds.size > 1 ? (
              <>
                <button
                  onClick={() => {
                    const itemsToCopy = items.filter(x => selectedIds.has(x.id) && (x.type === 'text' || x.type === 'link'));
                    const concatenated = itemsToCopy.map(x => x.value).join('\n');
                    if (concatenated) {
                      handleCopyText(concatenated);
                    }
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
                >
                  Copy Selected ({selectedIds.size})
                </button>
                <button
                  onClick={async () => {
                    const itemsToCopy = items.filter(x => selectedIds.has(x.id) && (x.type === 'text' || x.type === 'link'));
                    const concatenated = itemsToCopy.map(x => x.value).join('\n');
                    if (concatenated) {
                      await navigator.clipboard.writeText(concatenated);
                    }
                    handleCutSelected();
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
                >
                  Cut Selected ({selectedIds.size})
                </button>
                <button
                  onClick={async () => {
                    await handleDeleteSelected();
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive hover:text-white cursor-pointer transition-colors"
                >
                  Delete Selected ({selectedIds.size})
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    handleCopyItem(contextMenu.item!.id);
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
                >
                  Copy
                </button>

                <button
                  onClick={() => {
                    handleCutItem(contextMenu.item!.id);
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
                >
                  Move
                </button>

                {/* Download option (for photos/files) */}
                {(contextMenu.item.type === 'photo' || contextMenu.item.type === 'file') && (
                  <button
                    onClick={() => {
                      handleDownloadFile(contextMenu.item!);
                      setContextMenu((prev) => ({ ...prev, visible: false }));
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
                  >
                    Download File
                  </button>
                )}

                {/* Edit option */}
                <button
                  onClick={() => {
                    setEditPrompt({
                      visible: true,
                      itemId: contextMenu.item!.id,
                      label: contextMenu.item!.label,
                      value: contextMenu.item!.value,
                      type: contextMenu.item!.type,
                    });
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold hover:bg-primary hover:text-black cursor-pointer transition-colors"
                >
                  Edit
                </button>

                <button
                  onClick={() => {
                    handleDeleteItem(contextMenu.item!.id, contextMenu.item!.type);
                    setContextMenu((prev) => ({ ...prev, visible: false }));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs font-bold text-destructive hover:bg-destructive hover:text-white cursor-pointer transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}



        {/* CUSTOM EDIT PROMPT MODAL */}
        {editPrompt.visible && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 select-none animate-in fade-in duration-100">
            <div className="w-full max-w-sm">
              <TuiContainer label={`Edit ${editPrompt.type}`} disableHover={true}>
                <div className="py-2 flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-bold text-muted">Label / Date</label>
                    <input
                      type="text"
                      value={editPrompt.label}
                      onChange={(e) => setEditPrompt({ ...editPrompt, label: e.target.value })}
                      className="w-full border-[1.5px] border-border bg-card px-3 py-2 text-xs focus:outline-hidden font-mono text-foreground"
                    />
                  </div>

                  {(editPrompt.type === 'text' || editPrompt.type === 'link') && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] uppercase font-bold text-muted">Value / Content</label>
                      <textarea
                        value={editPrompt.value}
                        onChange={(e) => setEditPrompt({ ...editPrompt, value: e.target.value })}
                        rows={4}
                        className="w-full border-[1.5px] border-border bg-card px-3 py-2 text-xs focus:outline-hidden font-mono text-foreground resize-none"
                      />
                    </div>
                  )}

                  <div className="flex gap-4 mt-2">
                    <TuiButton
                      onPress={() => setEditPrompt({ ...editPrompt, visible: false })}
                      variant="outline"
                    >
                      Cancel
                    </TuiButton>
                    <TuiButton
                      onPress={async () => {
                        await handleSaveEdit(editPrompt.itemId, editPrompt.label, editPrompt.value, editPrompt.type);
                        setEditPrompt((prev) => ({ ...prev, visible: false }));
                      }}
                      variant="accent"
                    >
                      Save
                    </TuiButton>
                  </div>
                </div>
              </TuiContainer>
            </div>
          </div>
        )}

        {/* CUSTOM PAIRING CODE MODAL */}
        {pairingCode && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 select-none animate-in fade-in duration-100">
            <div className="w-full max-w-sm">
              <TuiContainer label="Pair Device" disableHover={true}>
                <div className="py-6 px-4 flex flex-col items-center gap-4">

                  
                  <div className="w-full flex flex-col gap-4 mt-2">
                    <div className="w-full text-4xl font-bold tracking-[0.5em] text-primary bg-card border-[1.5px] border-border py-6 text-center font-mono pl-[0.5em]">
                      {pairingCode}
                    </div>

                    <TuiButton
                      onPress={cancelPairing}
                      variant="outline"
                      className="w-full"
                    >
                      Cancel Pairing
                    </TuiButton>
                  </div>
                </div>
              </TuiContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

