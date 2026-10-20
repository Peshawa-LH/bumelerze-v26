/**
 * How the root stack presents the full-screen flows on iOS
 * (`app/_layout.tsx`). Read from the source: the root layout itself needs
 * the whole app (stores, queues, fonts) to render.
 */
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(__dirname, "../_layout.tsx"), "utf8");

/** The options object literal of `<Stack.Screen name="…" options={…} />`. */
function screenOptions(name: string): string | null {
  const pattern = new RegExp(
    `<Stack\\.Screen\\s+name="${name.replace(/[/[\]]/g, "\\$&")}"\\s+options=\\{(\\{[^}]*\\})\\}`,
  );
  return pattern.exec(source)?.[1] ?? null;
}

it("presents the felt report full screen, never as a sheet a swipe can close mid-report", () => {
  expect(screenOptions("felt-report")).toMatch(/presentation:\s*"fullScreenModal"/);
});

it("keeps the edge swipe off on the swipeable tour", () => {
  expect(screenOptions("tour")).toMatch(/gestureEnabled:\s*false/);
});
