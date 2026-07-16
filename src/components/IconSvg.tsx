import Svg, { Path, Circle, Rect } from 'react-native-svg';
import React from 'react';

export const IconSvg: React.FC<React.SVGProps<SVGSVGElement>> = (props) => {
  return (
    <Svg width={props.width || props.height || "18"} height={props.height || "18"} viewBox="0 0 100 100" fill={props.color || "none"} {...props}>
      {/* Lid */}
      <Rect x="2" y="3" width="12" height="1" />
      <Rect x="2" y="5" width="12" height="1" />
      <Rect x="2" y="3" width="1" height="3" />
      <Rect x="13" y="3" width="1" height="3" />

      {/* Body */}
      <Rect x="3" y="6" width="1" height="7" />
      <Rect x="12" y="6" width="1" height="7" />
      <Rect x="3" y="12" width="10" height="1" />

      {/* Handle */}
      <Rect x="6" y="7" width="4" height="1" />
    </Svg>
  );
};
