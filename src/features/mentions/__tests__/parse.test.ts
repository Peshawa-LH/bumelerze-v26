import {
  activeMention,
  applyMention,
  mentionCandidates,
  resolveMention,
  splitMentions,
  type MentionSegment,
} from "../parse";

type Mention = Extract<MentionSegment, { kind: "mention" }>;
const mentions = (text: string) =>
  splitMentions(text).filter((s): s is Mention => s.kind === "mention");

describe("splitMentions mirrors the server rule (0063)", () => {
  it("finds @names of 3 to 24 username characters, lower-cased", () => {
    expect(mentions("hi @Shirin and @dilan.k!").map((m) => m.name)).toEqual([
      "shirin",
      "dilan.k",
    ]);
  });

  it("keeps every character of the text, in order", () => {
    const text = "سڵاو @shirin، چۆنی؟ (@aso_1) end";
    const joined = splitMentions(text)
      .map((s) => (s.kind === "text" ? s.text : s.raw))
      .join("");
    expect(joined).toBe(text);
  });

  it("is not fooled by an email address, a double @ or too short a name", () => {
    expect(mentions("mail x@shirin.org or @@aso or @ab")).toEqual([]);
  });

  it("starts a mention after Arabic-script text or punctuation", () => {
    expect(mentions("بینیم@shirin").map((m) => m.name)).toEqual(["shirin"]);
    expect(mentions("(@shirin)").map((m) => m.name)).toEqual(["shirin"]);
  });

  it("offers a trailing full stop both ways", () => {
    const [m] = mentions("thanks @shirin.");
    expect(m).toMatchObject({ raw: "@shirin.", name: "shirin.", trimmed: "shirin" });
    expect(mentionCandidates(splitMentions("thanks @shirin. and @shirin"))).toEqual([
      "shirin.",
      "shirin",
    ]);
  });
});

describe("resolveMention", () => {
  const [dot] = mentions("@Shirin.");
  it("links the name as written when it exists", () => {
    expect(resolveMention(dot as Mention, new Set(["shirin."]))).toEqual({
      username: "shirin.",
      linkText: "@Shirin.",
      rest: "",
    });
  });
  it("else links it without the full stop, which stays plain", () => {
    expect(resolveMention(dot as Mention, new Set(["shirin"]))).toEqual({
      username: "shirin",
      linkText: "@Shirin",
      rest: ".",
    });
  });
  it("else leaves it plain", () => {
    expect(resolveMention(dot as Mention, new Set()).username).toBeNull();
  });
});

describe("activeMention and applyMention (the composer)", () => {
  it("sees the @name being typed at the caret", () => {
    expect(activeMention("hello @sh", 9)).toEqual({ start: 6, query: "sh" });
    expect(activeMention("hello @sh there", 9)).toEqual({ start: 6, query: "sh" });
    expect(activeMention("hello @sh there", 15)).toBeNull();
    expect(activeMention("a@sh", 4)).toBeNull();
  });

  it("puts '@username ' in place of the typed part", () => {
    expect(applyMention("hello @sh", { start: 6, query: "sh" }, "shirin")).toEqual({
      text: "hello @shirin ",
      caret: 14,
    });
    expect(applyMention("hi @sh you", { start: 3, query: "sh" }, "shirin").text).toBe(
      "hi @shirin you",
    );
  });
});
