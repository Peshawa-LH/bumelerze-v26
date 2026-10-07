import { SvgXml } from "react-native-svg";

import { PICTOGRAM_XML, type PictogramName } from "../pictograms.generated";

/**
 * One line pictogram of the questionnaire (structure, plan shape, photo
 * slot). The drawings use `currentColor`, so `color` (a theme token from the
 * caller) tints the whole drawing. Decorative by itself: the choice or button
 * that holds it carries the accessible label.
 */
export function Pictogram({
  name,
  color,
  size = 56,
}: {
  name: PictogramName;
  color: string;
  size?: number;
}) {
  return (
    <SvgXml
      xml={PICTOGRAM_XML[name]}
      width={size}
      height={size}
      color={color}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
