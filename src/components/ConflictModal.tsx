import { View, Text, Modal } from 'react-native';
import React from 'react';
import { TuiContainer } from './TuiContainer';
import { TuiButton } from './TuiButton';

interface ConflictModalProps {
  visible: boolean;
  title: string;
  message: string;
  options: Array<{
    text: string;
    onPress: () => void;
    style?: 'cancel' | 'destructive';
  }>;
  onClose?: () => void;
}

export const ConflictModal: React.FC<ConflictModalProps> = ({
  visible,
  title,
  message,
  options,
}) => {
  return (
    <Modal visible={visible} transparent={true} animationType="fade">
      <View className="flex-1 items-center justify-center bg-black/75 p-4">
        <View className="w-full max-w-md">
          <TuiContainer label={title} disableHover={true}>
            <View className="py-2">
              <Text className="text-sm leading-relaxed mb-6 font-mono text-foreground">
                {message}
              </Text>
              <View className="flex-col gap-3">
                {options.map((opt, idx) => (
                  <TuiButton
                    key={idx}
                    onPress={opt.onPress}
                    variant={
                      opt.style === 'destructive'
                        ? 'destructive'
                        : idx === 0
                        ? 'accent'
                        : 'outline'
                    }
                  >
                    {opt.text}
                  </TuiButton>
                ))}
              </View>
            </View>
          </TuiContainer>
        </View>
      </View>
    </Modal>
  );
};
