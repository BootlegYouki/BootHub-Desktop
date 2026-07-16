import { View, Text, Modal } from 'react-native';
import React from 'react';
import { TuiContainer } from './TuiContainer';
import { TuiButton } from './TuiButton';

interface TuiAlertModalProps {
  visible: boolean;
  title: string;
  message: string;
  type?: 'alert' | 'confirm';
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export const TuiAlertModal: React.FC<TuiAlertModalProps> = ({
  visible,
  title,
  message,
  type = 'alert',
  confirmText = 'OK',
  cancelText = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onCancel || onConfirm}
    >
      <View className="flex-1 items-center justify-center bg-black/70 p-4">
        <View className="w-full max-w-sm">
          <TuiContainer label={title} disableHover={true}>
            <View className="py-2">
              <Text className="text-sm font-mono leading-relaxed mb-6 text-foreground break-words">
                {message}
              </Text>
              <View className="flex-row gap-4">
                {type === 'confirm' && onCancel && (
                  <View className="flex-1">
                    <TuiButton onPress={onCancel} variant="outline">
                      {cancelText}
                    </TuiButton>
                  </View>
                )}
                <View className="flex-1">
                  <TuiButton
                    onPress={onConfirm}
                    variant={isDestructive ? 'destructive' : 'accent'}
                  >
                    {confirmText}
                  </TuiButton>
                </View>
              </View>
            </View>
          </TuiContainer>
        </View>
      </View>
    </Modal>
  );
};
