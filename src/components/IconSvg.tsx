import React from 'react';

export const IconSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => {
  return (
    <svg
      viewBox="0 0 16 16"
      width="100%"
      height="100%"
      fill="currentColor"
      {...props}
    >
      {/* Lid */}
      <rect x="2" y="3" width="12" height="1" />
      <rect x="2" y="5" width="12" height="1" />
      <rect x="2" y="3" width="1" height="3" />
      <rect x="13" y="3" width="1" height="3" />

      {/* Body */}
      <rect x="3" y="6" width="1" height="7" />
      <rect x="12" y="6" width="1" height="7" />
      <rect x="3" y="12" width="10" height="1" />

      {/* Handle */}
      <rect x="6" y="7" width="4" height="1" />
    </svg>
  );
};
