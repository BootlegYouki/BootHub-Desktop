import React, { useEffect, useState, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';
import { IconSvg } from './IconSvg';
import { TuiAlertModal } from './TuiAlertModal';

interface TitleBarProps {
  /** Title text displayed centered in the title bar */
  title?: string;
  /** Lucide icon component to show at the left of the bar */
  icon?: React.ComponentType<{ className?: string }>;
  /** Optional CSS classes for background coloring / styles */
  className?: string;
  /** Optional size for the icon (e.g. "size-4", "w-5 h-5") */
  iconSize?: string;
  /** Called before the window closes */
  onBeforeClose?: () => void;
  /** If true, close the window immediately without a confirmation dialog */
  skipCloseConfirm?: boolean;
  /** Optional elements to render beside the window controls */
  children?: React.ReactNode;
}

// Module-level cache to prevent icon flicker during React component remounting
let cachedMaximizedState = false;

export const TitleBar: React.FC<TitleBarProps> = ({
  title = 'BootHub',
  icon: Icon,
  className,
  iconSize = 'size-5',
  onBeforeClose,
  skipCloseConfirm = true,
  children,
}) => {
  const [maximized, setMaximized] = useState(cachedMaximizedState);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    // Seed initial state and update cache
    appWindow.isMaximized().then((isMax) => {
      setMaximized(isMax);
      cachedMaximizedState = isMax;
    });

    // Listen for resize to track maximized state
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await appWindow.onResized(async () => {
        const isMax = await appWindow.isMaximized();
        setMaximized(isMax);
        cachedMaximizedState = isMax;
      });
    };
    setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleMinimize = useCallback(() => getCurrentWindow().minimize(), []);
  const handleMaximize = useCallback(() => getCurrentWindow().toggleMaximize(), []);

  const handleClose = useCallback(() => {
    if (skipCloseConfirm) {
      onBeforeClose?.();
      getCurrentWindow().close();
    } else {
      setShowCloseConfirm(true);
    }
  }, [skipCloseConfirm, onBeforeClose]);

  const handleConfirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    onBeforeClose?.();
    getCurrentWindow().close();
  }, [onBeforeClose]);

  const handleCancelClose = useCallback(() => {
    setShowCloseConfirm(false);
  }, []);

  return (
    <>
      <div className={`titlebar ${className || ''}`}>
        {/* Left icon */}
        <div className="titlebar-icon text-primary flex items-center justify-center" data-tauri-drag-region>
          {Icon ? <Icon className={iconSize} /> : <IconSvg className="w-[18px] h-[18px]" />}
        </div>

        {/* Centered title */}
        {title && (
          <div className="titlebar-title font-bold font-mono" data-tauri-drag-region>
            {title}
          </div>
        )}

        {/* Spacer that fills and is draggable */}
        <div data-tauri-drag-region className="titlebar-drag" />

        {/* Custom actions */}
        {children && (
          <div className="flex items-center gap-1 h-full px-2">
            {children}
          </div>
        )}

        {/* Window controls */}
        <div className="titlebar-controls">
          <button
            className="titlebar-btn"
            onClick={handleMinimize}
            aria-label="Minimize"
          >
            <Minus className="w-[16px] h-[17px]" strokeWidth={1.6} />
          </button>
          <button
            className="titlebar-btn"
            onClick={handleMaximize}
            aria-label={maximized ? 'Restore' : 'Maximize'}
          >
            <Square className="h-[12px]" strokeWidth={2} />
          </button>
          <button
            className="titlebar-btn titlebar-btn-close"
            onClick={handleClose}
            aria-label="Close"
          >
            <X className="w-[18px]" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <TuiAlertModal
        visible={showCloseConfirm}
        title="Exit Application"
        message="Are you sure you want to close BootHub Desktop?"
        type="confirm"
        confirmText="Exit"
        cancelText="Cancel"
        isDestructive={true}
        onConfirm={handleConfirmClose}
        onCancel={handleCancelClose}
      />
    </>
  );
};
