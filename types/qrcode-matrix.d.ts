// react-native-qrcode-svg ships its matrix generator as plain JS source. The
// share card draws the QR itself, inside its own <Svg>, because that package's
// component renders a nested <Svg> of its own, which a single exported image
// cannot contain. Only this one function is used.
declare module "react-native-qrcode-svg/src/genMatrix" {
  /** Rows of dark (truthy) / light modules for `value` at the given error-correction level. */
  export default function genMatrix(
    value: string,
    errorCorrectionLevel?: "L" | "M" | "Q" | "H",
  ): (0 | 1 | boolean)[][];
}
