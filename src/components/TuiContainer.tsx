import { View, Text, Pressable, StyleProp, ViewStyle } from 'react-native';
import React from 'react';

interface TuiContainerProps {
  children: React.ReactNode;
  label: string;
  badge?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accentBorder?: boolean;
  onBadgePress?: () => void;
  noPadding?: boolean;
  onPress?: () => void;
  disableHover?: boolean;
}

export const TuiContainer: React.FC<TuiContainerProps> = ({
  children,
  label,
  badge,
  style,
  contentStyle,
  accentBorder = false,
  onBadgePress,
  noPadding = false,
  onPress,
  disableHover = false,
}) => {
  const borderClass = accentBorder
    ? 'border-primary'
    : disableHover
      ? 'border-border'
      : 'border-border';

  const legendClass = accentBorder
    ? 'text-primary'
    : 'text-foreground';

  const ContainerElement = onPress ? Pressable : View;

  return (
    <ContainerElement
      onPress={onPress}
      className={`w-full min-w-0 relative border-[1.5px] bg-card text-foreground ${borderClass}`}
      style={style}
    >
      {(label || badge) && (
        <View className="absolute -top-[10px] left-4 px-2 bg-card flex-row items-center gap-2 z-10">
          <Text className={`font-bold text-xs ${legendClass}`}>{label}</Text>
          {badge && (
            <Pressable
              onPress={(e) => {
                if (onBadgePress) {
                  e.stopPropagation();
                  onBadgePress();
                }
              }}
            >
              <Text
                className={`text-xs px-1 border-[1px] ${badge === 'ERROR' ? 'border-destructive text-destructive' : 'border-primary text-primary'}`}
              >
                {badge}
              </Text>
            </Pressable>
          )}
        </View>
      )}
      <View className={noPadding ? '' : 'p-3'} style={contentStyle}>
        {children}
      </View>
    </ContainerElement>
  );
};
