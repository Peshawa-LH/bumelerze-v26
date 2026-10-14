import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import i18n from "@/i18n";

import { AppRoot } from "../AppRoot.web";

/**
 * react-native-web resolves `marginStart`, `paddingEnd`, `end`,
 * `borderStartWidth`... from the `dir` of the nearest view that sets one,
 * not from `<html dir="rtl">`. The web root view sets it once for the whole
 * app, so Sorani and Arabic get the right edges everywhere.
 */
describe("AppRoot (web)", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    ["ckb", "rtl"],
    ["ar", "rtl"],
    ["kmr", "ltr"],
    ["en", "ltr"],
  ])("%s: the root view reads %s", async (locale, dir) => {
    await i18n.changeLanguage(locale);
    await render(
      <AppRoot>
        <Text>child</Text>
      </AppRoot>,
    );
    expect(screen.getByTestId("app-root").props.dir).toBe(dir);
  });
});
