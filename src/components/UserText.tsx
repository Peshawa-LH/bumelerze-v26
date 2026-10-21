import { Fragment, type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { physicalTextAlign, textDirectionFor, type TextDirection } from "@/i18n";
import { firstStrongDirection } from "@/i18n/bidi";

/** How one paragraph is drawn: a plain `Text` by default, `MentionText` for
 * comments and posts (their @usernames are links). */
export type RenderParagraph = (
  text: string,
  style: TextStyle,
  testID: string | undefined,
) => ReactNode;

export interface UserTextProps {
  /** What a person wrote: a comment, a post, a bio, feedback, a note. */
  text: string;
  /** The app language: the direction of a paragraph without any letter. */
  locale: string;
  style: TextStyle;
  testID?: string;
  /** Height of an empty line between paragraphs (iOS/Android). */
  lineHeight?: number;
  numberOfLines?: number;
  selectable?: boolean;
  /** The block that holds the paragraphs when there is more than one. */
  paragraphsStyle?: StyleProp<ViewStyle>;
  renderParagraph?: RenderParagraph;
}

/** The direction and reading-start side of one paragraph on iOS/Android:
 * its first letter's direction, or the app language's when it has none. */
export function paragraphDirectionStyle(
  paragraph: string,
  locale: string,
): { writingDirection: TextDirection; textAlign: ReturnType<typeof physicalTextAlign> } {
  const direction = firstStrongDirection(paragraph) ?? textDirectionFor(locale);
  return {
    writingDirection: direction,
    textAlign: physicalTextAlign(direction === "rtl" ? "right" : "left"),
  };
}

/**
 * Text a person wrote. Each paragraph reads in its own direction and starts
 * at its own edge, as the web lays out such text: an English line in a
 * Sorani thread sits on the left, a Sorani line in an English one on the
 * right. iOS has no `dir="auto"`: there a paragraph without an alignment
 * follows the app's iOS language, whatever it is written in. So on
 * iOS/Android each paragraph gets the direction of its first letter
 * (`firstStrongDirection`, which skips digits, isolates and @usernames like a
 * browser) and its own `Text`; the web keeps the one element it had.
 */
export function UserText({
  text,
  locale,
  style,
  testID,
  lineHeight,
  numberOfLines,
  selectable,
  paragraphsStyle,
  renderParagraph,
}: UserTextProps) {
  const render: RenderParagraph =
    renderParagraph ??
    ((paragraph, paragraphStyle, paragraphTestID) => (
      <Text
        style={paragraphStyle}
        testID={paragraphTestID}
        {...(numberOfLines === undefined ? {} : { numberOfLines })}
        {...(selectable === undefined ? {} : { selectable })}
      >
        {paragraph}
      </Text>
    ));
  if (Platform.OS === "web") {
    return <>{render(text, style, testID)}</>;
  }
  const paragraphs = text.split("\n");
  if (paragraphs.length === 1 || numberOfLines !== undefined) {
    return (
      <>{render(text, { ...style, ...paragraphDirectionStyle(text, locale) }, testID)}</>
    );
  }
  return (
    <View testID={testID} style={paragraphsStyle ?? styles.paragraphs}>
      {paragraphs.map((paragraph, index) =>
        paragraph.trim().length === 0 ? (
          <View key={index} style={{ height: lineHeight ?? style.lineHeight ?? 0 }} />
        ) : (
          <Fragment key={index}>
            {render(
              paragraph,
              { ...style, ...paragraphDirectionStyle(paragraph, locale), marginTop: 0 },
              undefined,
            )}
          </Fragment>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  paragraphs: { alignSelf: "stretch" },
});
