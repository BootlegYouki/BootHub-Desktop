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
}) => {
  const borderClass = accentBorder
    ? 'border-primary'
    : 'border-border hover:border-foreground';

  const legendClass = accentBorder
    ? 'text-primary'
    : 'text-foreground';

  return (
    <fieldset
      onClick={onPress}
      className={`group w-full min-w-0 relative border-[1.5px] bg-card text-foreground ${borderClass} ${
        onPress ? 'cursor-pointer hover:scale-[1.01] active:scale-[0.99]' : ''
      }`}
      style={style}
    >
      {(label || badge) && (
        <legend className={`px-2 font-bold text-sm select-none flex items-center gap-2 ml-4 ${legendClass}`}>
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
        </legend>
      )}
      <div className={noPadding ? '' : 'p-3'} style={contentStyle}>
        {children}
      </div>
    </fieldset>
  );
};
