import { View, Text, Pressable } from 'react-native';
import React, { useState, useCallback } from 'react';
import { Minus, Square, X } from 'lucide-react-native';
import { IconSvg } from './IconSvg';
import { TuiAlertModal } from './TuiAlertModal';

interface TitleBarProps {
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  iconSize?: string;
  onBeforeClose?: () => void;
  skipCloseConfirm?: boolean;
  children?: React.ReactNode;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  title = 'BootHub',
  icon: Icon,
  className = '',
  iconSize = 'w-5 h-5',
  onBeforeClose,
  skipCloseConfirm = true,
  children,
}) => {
  const [maximized, setMaximized] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const handleMinimize = useCallback(() => {
    // TODO: implement Windows native minimize
  }, []);
  
  const handleMaximize = useCallback(() => {
    // TODO: implement Windows native maximize
    setMaximized(!maximized);
  }, [maximized]);

  const handleClose = useCallback(() => {
    if (skipCloseConfirm) {
      onBeforeClose?.();
      // TODO: implement Windows native close
    } else {
      setShowCloseConfirm(true);
    }
  }, [skipCloseConfirm, onBeforeClose]);

  const handleConfirmClose = useCallback(() => {
    setShowCloseConfirm(false);
    onBeforeClose?.();
    // TODO: implement Windows native close
  }, [onBeforeClose]);

  const handleCancelClose = useCallback(() => {
    setShowCloseConfirm(false);
  }, []);

  return (
    <>
      <View className={`h-[30px] flex-row items-center bg-card border-b-[1.5px] border-border ${className}`}>
        <View className="w-[36px] h-full items-center justify-center">
          {Icon ? <Icon className={iconSize} /> : <IconSvg />}
        </View>

        {title && (
          <View className="absolute left-1/2 -translate-x-1/2">
            <Text className="font-bold font-mono text-[12px] text-muted tracking-widest">{title}</Text>
          </View>
        )}

        <View className="flex-1" />

        {children && (
          <View className="flex-row items-center gap-1 h-full px-2">
            {children}
          </View>
        )}

        <View className="flex-row h-full">
          <Pressable onPress={handleMinimize} className="w-[46px] items-center justify-center hover:bg-white/10">
            <Minus size={16} color="#71717a" strokeWidth={1.6} />
          </Pressable>
          <Pressable onPress={handleMaximize} className="w-[46px] items-center justify-center hover:bg-white/10">
            <Square size={12} color="#71717a" strokeWidth={2} />
          </Pressable>
          <Pressable onPress={handleClose} className="w-[46px] items-center justify-center hover:bg-destructive active:bg-destructive/80">
            <X size={18} color="#71717a" strokeWidth={1.5} />
          </Pressable>
        </View>
      </View>

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
