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
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-4 select-none">
      <div className="w-full max-w-md">
        <TuiContainer label={title} disableHover={true}>
          <div className="py-2">
            <p className="text-sm leading-relaxed mb-6 font-mono text-foreground whitespace-pre-line">
              {message}
            </p>
            <div className="flex flex-col gap-3">
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
            </div>
          </div>
        </TuiContainer>
      </div>
    </div>
  );
};
