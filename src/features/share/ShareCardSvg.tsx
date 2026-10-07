import { forwardRef } from "react";
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

export interface ShareCardSvgProps {
  model: CardModel;
  /** Rendered width on screen; the card scales to it (the export is 1080). */
  displayWidth: number;
}

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

function CardTextShape({ item }: { item: CardText }) {
  const family = item.weight === 700 ? SHARE_FONT_BOLD : SHARE_FONT_REGULAR;
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

/**
 * The share card, drawn from a `CardModel` and nothing else: no theme, no
 * hooks, no translation. The same element tree is rasterised on the phone
 * (`Svg.toDataURL`) and, after font embedding, in the browser. Sized by
 * `displayWidth` (the viewBox is always the 1080-wide card), so it can be
 * mounted small and exported large.
 *
 * Not a screen element: the share sheet mounts it hidden, only while an image
 * is being made.
 */
export const ShareCardSvg = forwardRef<Svg, ShareCardSvgProps>(function ShareCardSvg(
  { model, displayWidth },
  ref,
) {
  const { map } = model;
  const clipId = `share-map-clip-${model.size}`;
  const displayHeight = (displayWidth * model.height) / model.width;
  const box = BUMELERZE_MARK_VIEW_BOX;
  const markTransform = `translate(${model.mark.x - box.x * model.mark.scale} ${
    model.mark.y - box.y * model.mark.scale
  }) scale(${model.mark.scale})`;

  return (
    <Svg
      ref={ref}
      width={displayWidth}
      height={displayHeight}
      viewBox={`0 0 ${model.width} ${model.height}`}
    >
      <Defs>
        <ClipPath id={clipId}>
          <Rect
            x={map.frame.x}
            y={map.frame.y}
            width={map.frame.width}
            height={map.frame.height}
            rx={map.frame.radius}
            ry={map.frame.radius}
          />
        </ClipPath>
      </Defs>

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

      <G clipPath={`url(#${clipId})`}>
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
        {map.labels.map((label, index) => (
          <CardTextShape key={`label${index}`} item={label} />
        ))}
        <Polygon
          points={map.star.points}
          fill={map.star.fill}
          stroke={map.star.stroke}
          strokeWidth={map.star.strokeWidth}
          strokeLinejoin="round"
        />
      </G>
      <Rect
        x={map.frame.x}
        y={map.frame.y}
        width={map.frame.width}
        height={map.frame.height}
        rx={map.frame.radius}
        ry={map.frame.radius}
        fill="none"
        {...(map.frame.stroke === undefined
          ? {}
          : { stroke: map.frame.stroke.color, strokeWidth: map.frame.stroke.width })}
      />
      {model.overlay.map((rect, index) => (
        <CardRectShape key={`o${index}`} rect={rect} />
      ))}

      {model.legendChips.map((chip) => (
        <G key={`chip${chip.level}`}>
          <CardRectShape rect={chip.rect} />
          <CardTextShape item={chip.label} />
        </G>
      ))}

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

      {model.texts.map((item, index) => (
        <CardTextShape key={`t${index}`} item={item} />
      ))}
    </Svg>
  );
});
