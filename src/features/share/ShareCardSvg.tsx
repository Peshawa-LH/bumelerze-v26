import { forwardRef, useEffect, type Ref } from "react";
import { Platform, StyleSheet, Text, View, type TextStyle } from "react-native";
import Svg, {
  ClipPath,
  Circle,
  Defs,
  G,
  Path,
  Polygon,
  Rect,
  Text as SvgText,
  TSpan,
} from "react-native-svg";

import {
  BUMELERZE_MARK_DOT,
  BUMELERZE_MARK_PATH,
  BUMELERZE_MARK_VIEW_BOX,
} from "@/features/badges/bumelerze-mark";
import type { CardModel, CardRect, CardText } from "./card-layout";
import { POP_DIRECTIONAL_ISOLATE, RIGHT_TO_LEFT_ISOLATE } from "./config";
import { SHARE_FONT_BOLD, SHARE_FONT_REGULAR } from "./share-font-names";
import { ensureShareFontsLoaded } from "./share-fonts";

export interface ShareCardSvgProps {
  model: CardModel;
  /** Rendered width on screen; the card scales to it (the export is 1080). */
  displayWidth: number;
}

/** What the card's ref points at: the `<svg>` on the web (the exporter
 * serialises it), the card's outer view on a phone (the exporter captures it
 * as a picture). */
export type ShareCardRef = Svg | View;

/**
 * Text in a right-to-left language is wrapped in a bidi isolate. The card
 * positions every string by a physical anchor (left/right edge), and the
 * isolate fixes the paragraph direction of the string itself, so a Sorani line
 * mixing words, digits and a Latin place name orders correctly whatever
 * direction the page around the SVG has.
 */
export function isolateForSvg(text: string, rtl: boolean): string {
  return rtl ? `${RIGHT_TO_LEFT_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}` : text;
}

function CardRectShape({ rect }: { rect: CardRect }) {
  return (
    <Rect
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      rx={rect.radius}
      ry={rect.radius}
      fill={rect.fill}
      {...(rect.opacity === undefined ? {} : { fillOpacity: rect.opacity })}
      {...(rect.stroke === undefined
        ? {}
        : { stroke: rect.stroke.color, strokeWidth: rect.stroke.width })}
    />
  );
}

function fontFamilyFor(item: CardText): string {
  return item.weight === 700 ? SHARE_FONT_BOLD : SHARE_FONT_REGULAR;
}

function CardTextShape({ item }: { item: CardText }) {
  const family = fontFamilyFor(item);
  const content = isolateForSvg(item.text, item.rtl);
  if (item.runs) {
    // One line of mixed sizes. The bidi isolate wraps the whole line, so the
    // runs order correctly in a right-to-left language.
    const last = item.runs.length - 1;
    return (
      <SvgText
        x={item.x}
        y={item.y}
        fontFamily={family}
        fontSize={item.size}
        textAnchor={item.anchor}
        fill={item.fill}
      >
        {item.runs.map((run, index) => (
          <TSpan key={index} fontSize={run.size}>
            {(item.rtl && index === 0 ? RIGHT_TO_LEFT_ISOLATE : "") +
              run.text +
              (item.rtl && index === last ? POP_DIRECTIONAL_ISOLATE : "")}
          </TSpan>
        ))}
      </SvgText>
    );
  }
  return (
    <>
      {item.halo ? (
        <SvgText
          x={item.x}
          y={item.y}
          fontFamily={family}
          fontSize={item.size}
          textAnchor={item.anchor}
          fill="none"
          stroke={item.halo.stroke}
          strokeWidth={item.halo.width}
          strokeLinejoin="round"
        >
          {content}
        </SvgText>
      ) : null}
      <SvgText
        x={item.x}
        y={item.y}
        fontFamily={family}
        fontSize={item.size}
        textAnchor={item.anchor}
        fill={item.fill}
        {...(item.opacity === undefined ? {} : { fillOpacity: item.opacity })}
      >
        {content}
      </SvgText>
    </>
  );
}

function clipIdFor(model: CardModel): string {
  return `share-map-clip-${model.size}`;
}

function MapClipDefs({ model }: { model: CardModel }) {
  const { frame } = model.map;
  return (
    <Defs>
      <ClipPath id={clipIdFor(model)}>
        <Rect
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={frame.height}
          rx={frame.radius}
          ry={frame.radius}
        />
      </ClipPath>
    </Defs>
  );
}

/** Map background, intensity bands, borders, rings and town dots: everything
 * in the map frame that sits under the town names. */
function MapShapes({ model }: { model: CardModel }) {
  const { map } = model;
  return (
    <>
      <Rect
        x={map.frame.x}
        y={map.frame.y}
        width={map.frame.width}
        height={map.frame.height}
        fill={map.background}
      />
      {map.bands.map((band) => (
        <Path
          key={`band${band.level}`}
          d={band.d}
          fill={band.fill}
          fillOpacity={map.bandOpacity}
          fillRule="evenodd"
        />
      ))}
      {map.lines.map((line, index) => (
        <Path
          key={`line${index}`}
          d={line.d}
          fill="none"
          stroke={line.stroke}
          strokeWidth={line.width}
          strokeOpacity={line.opacity}
          strokeLinejoin="round"
          strokeLinecap="round"
          {...(line.dash === undefined ? {} : { strokeDasharray: line.dash })}
        />
      ))}
      {map.rings.map((ring, index) => (
        <Circle
          key={`ring${index}`}
          cx={ring.cx}
          cy={ring.cy}
          r={ring.r}
          fill="none"
          stroke={map.ringStyle.stroke}
          strokeWidth={map.ringStyle.width}
          strokeOpacity={map.ringStyle.opacity}
          strokeDasharray={map.ringStyle.dash}
        />
      ))}
      {map.towns.map((town, index) => (
        <Circle
          key={`town${index}`}
          cx={town.x}
          cy={town.y}
          r={town.radius}
          fill={map.townDot.fill}
          stroke={map.townDot.halo}
          strokeWidth={3}
        />
      ))}
    </>
  );
}

function MapStar({ model }: { model: CardModel }) {
  const { star } = model.map;
  return (
    <Polygon
      points={star.points}
      fill={star.fill}
      stroke={star.stroke}
      strokeWidth={star.strokeWidth}
      strokeLinejoin="round"
    />
  );
}

function MapFrameStroke({ model }: { model: CardModel }) {
  const { frame } = model.map;
  return (
    <Rect
      x={frame.x}
      y={frame.y}
      width={frame.width}
      height={frame.height}
      rx={frame.radius}
      ry={frame.radius}
      fill="none"
      {...(frame.stroke === undefined
        ? {}
        : { stroke: frame.stroke.color, strokeWidth: frame.stroke.width })}
    />
  );
}

function QrAndMark({ model }: { model: CardModel }) {
  const box = BUMELERZE_MARK_VIEW_BOX;
  const markTransform = `translate(${model.mark.x - box.x * model.mark.scale} ${
    model.mark.y - box.y * model.mark.scale
  }) scale(${model.mark.scale})`;
  return (
    <>
      {model.qr ? (
        <>
          <CardRectShape rect={model.qr.tile} />
          <G transform={`translate(${model.qr.x} ${model.qr.y})`}>
            <Path d={model.qr.path} fill={model.qr.fill} />
          </G>
        </>
      ) : null}

      <G transform={markTransform}>
        <Path d={BUMELERZE_MARK_PATH} fill={model.mark.fill} />
        <Circle
          cx={BUMELERZE_MARK_DOT.cx}
          cy={BUMELERZE_MARK_DOT.cy}
          r={BUMELERZE_MARK_DOT.r}
          fill={model.mark.fill}
        />
      </G>
    </>
  );
}

/**
 * The browser card: one `<svg>`, text included. The browser shapes Sorani
 * and Arabic inside SVG text correctly, and the exporter serialises this
 * exact element tree with the fonts embedded (`image-export.web.ts`).
 */
const WebCard = forwardRef<Svg, ShareCardSvgProps>(function WebCard(
  { model, displayWidth },
  ref,
) {
  const displayHeight = (displayWidth * model.height) / model.width;
  return (
    <Svg
      ref={ref}
      width={displayWidth}
      height={displayHeight}
      viewBox={`0 0 ${model.width} ${model.height}`}
    >
      <MapClipDefs model={model} />

      <Rect
        x={0}
        y={0}
        width={model.width}
        height={model.height}
        fill={model.background}
      />
      {model.underlay.map((rect, index) => (
        <CardRectShape key={`u${index}`} rect={rect} />
      ))}

      <G clipPath={`url(#${clipIdFor(model)})`}>
        <MapShapes model={model} />
        {model.map.labels.map((label, index) => (
          <CardTextShape key={`label${index}`} item={label} />
        ))}
        <MapStar model={model} />
      </G>
      <MapFrameStroke model={model} />
      {model.overlay.map((rect, index) => (
        <CardRectShape key={`o${index}`} rect={rect} />
      ))}

      {model.legendChips.map((chip) => (
        <G key={`chip${chip.level}`}>
          <CardRectShape rect={chip.rect} />
          <CardTextShape item={chip.label} />
        </G>
      ))}

      <QrAndMark model={model} />

      {model.texts.map((item, index) => (
        <CardTextShape key={`t${index}`} item={item} />
      ))}
    </Svg>
  );
});

/** Vazirmatn's ascender as a fraction of the font size (hhea 2100 of 2048
 * units, the same for every weight). A phone lays a line of text out with
 * its baseline this far below the top of the text box, so a box placed this
 * far above the card's baseline puts the glyphs exactly where the SVG
 * `<text y>` would. */
export const SHARE_FONT_ASCENT = 2100 / 2048;

/** How a card string becomes an absolutely placed phone text box, in card
 * units (the 1080-wide image). The box is wide enough never to wrap; the
 * anchor picks the edge it hangs from. Pure, so it is tested directly. */
export function nativeTextBox(
  item: CardText,
  boxWidth: number,
): { left: number; top: number; width: number; textAlign: "left" | "right" | "center" } {
  const tallest = item.runs
    ? Math.max(item.size, ...item.runs.map((run) => run.size))
    : item.size;
  const top = item.y - SHARE_FONT_ASCENT * tallest;
  if (item.anchor === "start") {
    return { left: item.x, top, width: boxWidth, textAlign: "left" };
  }
  if (item.anchor === "end") {
    return { left: item.x - boxWidth, top, width: boxWidth, textAlign: "right" };
  }
  return { left: item.x - boxWidth / 2, top, width: boxWidth, textAlign: "center" };
}

/** Eight directions for the halo copies (map labels), unit length. */
const HALO_DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

interface NativeTextProps {
  item: CardText;
  /** Display pixels per card unit. */
  scale: number;
  boxWidth: number;
  /** Card coordinates of the parent box's top-left corner. */
  originX?: number;
  originY?: number;
}

/**
 * One card string as a phone `Text`. react-native-svg draws Arabic-script
 * text glyph by glyph on iOS, without the font's joining and positioning:
 * Sorani came out as overlapping, unjoined letters (checked on the iOS
 * Simulator, 2026-10-20). The system text engine shapes it correctly, so on
 * the phone the card's words are real text laid over the drawing, at the
 * same place, size and face.
 */
function NativeCardText({ item, scale, boxWidth, originX = 0, originY = 0 }: NativeTextProps) {
  const box = nativeTextBox(item, boxWidth);
  const left = (box.left - originX) * scale;
  const top = (box.top - originY) * scale;
  const style: TextStyle = {
    position: "absolute",
    left,
    top,
    width: box.width * scale,
    textAlign: box.textAlign,
    fontFamily: fontFamilyFor(item),
    fontSize: item.size * scale,
    color: item.fill,
    includeFontPadding: false,
    ...(item.opacity === undefined ? {} : { opacity: item.opacity }),
  };
  const last = item.runs ? item.runs.length - 1 : 0;
  const content = item.runs
    ? item.runs.map((run, index) => (
        <Text key={index} style={{ fontSize: run.size * scale }}>
          {(item.rtl && index === 0 ? RIGHT_TO_LEFT_ISOLATE : "") +
            run.text +
            (item.rtl && index === last ? POP_DIRECTIONAL_ISOLATE : "")}
        </Text>
      ))
    : isolateForSvg(item.text, item.rtl);
  const halo = item.halo;
  return (
    <>
      {halo
        ? HALO_DIRECTIONS.map(([dx, dy], index) => (
            <Text
              key={`halo${index}`}
              allowFontScaling={false}
              numberOfLines={1}
              style={[
                style,
                {
                  color: halo.stroke,
                  opacity: 1,
                  left: left + (dx * halo.width * scale) / 2,
                  top: top + (dy * halo.width * scale) / 2,
                },
              ]}
            >
              {content}
            </Text>
          ))
        : null}
      <Text allowFontScaling={false} numberOfLines={1} style={style}>
        {content}
      </Text>
    </>
  );
}

/**
 * The phone card: the drawing in two SVG layers (under and over the town
 * names, as on the web), every word as phone text between and above them.
 * The ref is the outer view, which `image-export.ts` captures as the PNG.
 */
const NativeCard = forwardRef<View, ShareCardSvgProps>(function NativeCard(
  { model, displayWidth },
  ref,
) {
  const scale = displayWidth / model.width;
  const displayHeight = (displayWidth * model.height) / model.width;
  const { frame } = model.map;
  const viewBox = `0 0 ${model.width} ${model.height}`;
  const clip = `url(#${clipIdFor(model)})`;
  return (
    <View
      ref={ref}
      collapsable={false}
      testID="share-card-native"
      // The card places every string by a physical edge; its box must not
      // mirror under a right-to-left app layout.
      style={[styles.card, { width: displayWidth, height: displayHeight }]}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        width={displayWidth}
        height={displayHeight}
        viewBox={viewBox}
      >
        <MapClipDefs model={model} />
        <Rect
          x={0}
          y={0}
          width={model.width}
          height={model.height}
          fill={model.background}
        />
        {model.underlay.map((rect, index) => (
          <CardRectShape key={`u${index}`} rect={rect} />
        ))}
        <G clipPath={clip}>
          <MapShapes model={model} />
        </G>
      </Svg>

      <View
        pointerEvents="none"
        style={[
          styles.mapLabels,
          {
            left: frame.x * scale,
            top: frame.y * scale,
            width: frame.width * scale,
            height: frame.height * scale,
            borderRadius: frame.radius * scale,
          },
        ]}
      >
        {model.map.labels.map((label, index) => (
          <NativeCardText
            key={`label${index}`}
            item={label}
            scale={scale}
            boxWidth={model.width}
            originX={frame.x}
            originY={frame.y}
          />
        ))}
      </View>

      <Svg
        style={StyleSheet.absoluteFill}
        width={displayWidth}
        height={displayHeight}
        viewBox={viewBox}
      >
        <MapClipDefs model={model} />
        <G clipPath={clip}>
          <MapStar model={model} />
        </G>
        <MapFrameStroke model={model} />
        {model.overlay.map((rect, index) => (
          <CardRectShape key={`o${index}`} rect={rect} />
        ))}
        {model.legendChips.map((chip) => (
          <CardRectShape key={`chip${chip.level}`} rect={chip.rect} />
        ))}
        <QrAndMark model={model} />
      </Svg>

      {model.legendChips.map((chip) => (
        <NativeCardText
          key={`chip${chip.level}`}
          item={chip.label}
          scale={scale}
          boxWidth={model.width}
        />
      ))}
      {model.texts.map((item, index) => (
        <NativeCardText key={`t${index}`} item={item} scale={scale} boxWidth={model.width} />
      ))}
    </View>
  );
});

/**
 * The share card, drawn from a `CardModel` and nothing else: no theme, no
 * translation. Sized by `displayWidth` (the model is always the 1080-wide
 * card), so it can be mounted small and exported large.
 *
 * Web: one SVG, rasterised after font embedding. Phone: the same drawing
 * with its words as phone text (see `NativeCardText`), captured as a
 * picture. Shown on the Event hub's first slide, and mounted hidden by the
 * share sheet while an image is being made. Its one side effect: on the web
 * it fetches its two faces the first time a card renders (`share-fonts.ts`).
 */
export const ShareCardSvg = forwardRef<ShareCardRef, ShareCardSvgProps>(function ShareCardSvg(
  props,
  ref,
) {
  useEffect(() => {
    void ensureShareFontsLoaded();
  }, []);
  if (Platform.OS === "web") {
    return <WebCard ref={ref as Ref<Svg>} {...props} />;
  }
  return <NativeCard ref={ref as Ref<View>} {...props} />;
});

const styles = StyleSheet.create({
  card: { direction: "ltr", overflow: "hidden" },
  mapLabels: { position: "absolute", overflow: "hidden" },
});
