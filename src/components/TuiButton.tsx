import { View, Text, Pressable, StyleProp, ViewStyle, GestureResponderEvent, ActivityIndicator } from 'react-native';
import React from 'react';

interface TuiButtonProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  className?: string;
  variant?: 'default' | 'accent' | 'destructive' | 'outline';
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
}

export const TuiButton: React.FC<TuiButtonProps> = ({
  children,
  onPress,
  style,
  className = '',
  variant = 'default',
  disabled = false,
  loading = false,
  accessibilityLabel,
}) => {
  const getVariantClasses = () => {
    if (disabled) {
      return 'bg-[#18181b] border-[#27272a] opacity-50';
    }

    switch (variant) {
      case 'accent':
        return 'bg-primary border-primary active:bg-primary/20';
      case 'destructive':
        return 'bg-destructive border-destructive active:bg-destructive/20';
      case 'outline':
        return 'bg-transparent border-primary active:bg-primary/20';
      default:
        return 'bg-transparent border-primary active:bg-primary/80';
    }
  };

  const getVariantTextClasses = () => {
    if (disabled) {
      return 'text-[#52525b]';
    }
    switch (variant) {
      case 'accent':
      case 'destructive':
        return 'text-primary-foreground';
      case 'outline':
      default:
        return 'text-primary';
    }
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled || loading}
      onPress={onPress}
      className={`border-[1.5px] py-2 px-4 flex-row items-center justify-center min-h-[40px] w-full ${getVariantClasses()} ${className}`}
      style={style}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'accent' || variant === 'destructive' ? '#000' : '#a855f7'} />
      ) : (
        typeof children === 'string' ? (
          <Text className={`font-bold text-center text-sm ${getVariantTextClasses()}`}>{children}</Text>
        ) : (
          children
        )
      )}
    </Pressable>
  );
};
