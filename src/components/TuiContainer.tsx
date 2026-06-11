import React from 'react';

interface TuiContainerProps {
  children: React.ReactNode;
  label: string;
  badge?: string;
  style?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
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
      : 'border-border hover:border-foreground';

  const legendClass = accentBorder
    ? 'text-primary'
    : 'text-foreground';

  return (
    <div
      onClick={onPress}
      className={`group w-full min-w-0 relative border-[1.5px] bg-card text-foreground ${borderClass} ${
        onPress ? 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]' : ''
      }`}
      style={style}
    >
      {(label || badge) && (
        <div className={`absolute -top-[10px] left-4 px-2 bg-card font-bold text-xs select-none flex items-center gap-2 z-10 ${legendClass}`}>
          {label}
          {badge && (
            <span
              onClick={(e) => {
                if (onBadgePress) {
                  e.stopPropagation();
                  onBadgePress();
                }
              }}
              className={`text-xs px-1 border-[1px] ${
                onBadgePress ? 'cursor-pointer hover:bg-primary/20' : ''
              } ${badge === 'ERROR' ? 'border-destructive text-destructive' : 'border-primary text-primary'}`}
            >
              {badge}
            </span>
          )}
        </div>
      )}
      <div className={noPadding ? '' : 'p-3'} style={contentStyle}>
        {children}
      </div>
    </div>
  );
};
