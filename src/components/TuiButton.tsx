import React from 'react';

interface TuiButtonProps {
  children: React.ReactNode;
  onPress?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
  className?: string;
  variant?: 'default' | 'accent' | 'destructive' | 'outline';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
}

export const TuiButton: React.FC<TuiButtonProps> = ({
  children,
  onPress,
  style,
  className = '',
  variant = 'default',
  disabled = false,
  loading = false,
  type = 'submit',
  title,
}) => {
  const getVariantClasses = () => {
    if (disabled) {
      return 'bg-[#18181b] border-[#27272a] text-[#52525b] cursor-not-allowed';
    }

    switch (variant) {
      case 'accent':
        return 'bg-primary border-primary text-primary-foreground hover:bg-transparent hover:text-primary active:bg-primary/20';
      case 'destructive':
        return 'bg-destructive border-destructive text-white hover:bg-transparent hover:text-destructive active:bg-destructive/20';
      case 'outline':
        return 'bg-transparent border-primary text-primary hover:bg-primary/10 active:bg-primary/20';
      default:
        return 'bg-transparent border-primary text-foreground hover:bg-primary hover:text-primary-foreground active:bg-primary/80';
    }
  };

  return (
    <button
      type={type}
      title={title}
      disabled={disabled || loading}
      onClick={onPress}
      className={`border-[1.5px] font-bold text-center text-sm py-2 px-4 cursor-pointer flex items-center justify-center min-h-[40px] select-none w-full ${getVariantClasses()} ${className}`}
      style={style}
    >
      {loading ? (
        <span className="inline-block animate-spin border-2 border-current border-t-transparent rounded-full w-4 h-4" />
      ) : (
        children
      )}
    </button>
  );
};
