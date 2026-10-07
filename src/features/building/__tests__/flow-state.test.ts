import { HOME_PHOTO_MAX_COUNT } from "../constants";
import { PHOTO_SLOTS } from "../photos";
import {
  addExtraPhoto,
  canAddPhoto,
  canAdvance,
  editStep,
  flowKind,
  goBack,
  goNext,
  initialFlowState,
  isOptionalQuestion,
  photoCount,
  photoList,
  progress,
  removeExtraPhoto,
  sequence,
  setAnswer,
  setExtraCaption,
  setPhoto,
  type FlowState,
} from "../flow-state";

/** Every question answered, for a frame building. */
const COMPLETE = {
  use: "house",
  floors: "f2",
  basement: "none",
  age: "dk",
  builder: "dk",
  structure: "frame",
  added: "no",
  openGround: "no",
  shape: "box",
  adjacency: "alone",
  strengthened: "no",
  cracks: "none",
  pastDamage: "none",
};

const LAST_QUESTION = "remarks";

function atQuestions(answers = {}): FlowState {
  return {
    ...initialFlowState("new", answers),
    step: "question",
    location: { lat: 36.19, lon: 44.01, quality: "town", placeId: "erbil" },
  };
}

describe("flow sequence", () => {
  it("a new home goes home type, location, questions, photos, review", () => {
    const steps = sequence(initialFlowState("new"));
    expect(steps[0]?.step).toBe("kind");
    expect(steps[1]?.step).toBe("location");
    // The home type is answered on the first screen, not asked again as a question.
    expect(steps[2]).toEqual({ step: "question", questionId: "floors" });
    expect(steps.some((ref) => ref.questionId === "use")).toBe(false);
    expect(steps.at(-2)?.step).toBe("photos");
    expect(steps.at(-1)?.step).toBe("review");
  });

  it("a retake is questions then review", () => {
    const steps = sequence(initialFlowState("retake"));
    expect(steps[0]?.step).toBe("question");
    expect(steps.at(-1)?.step).toBe("review");
    expect(steps.some((ref) => ref.step === "kind" || ref.step === "photos")).toBe(false);
  });

  it("walls add the belts and roof questions; stone adds the stone question", () => {
    const ids = (answers: object) =>
      sequence({ mode: "retake", answers }).flatMap((ref) =>
        ref.questionId ? [ref.questionId] : [],
      );
    expect(ids({ structure: "block" })).toEqual(
      expect.arrayContaining(["belts", "roof"]),
    );
    expect(ids({ structure: "stone" })).toContain("stone");
    expect(ids({ structure: "stone" })).not.toContain("belts");
    expect(ids({ structure: "frame" })).not.toContain("belts");
    expect(ids({})).not.toContain("roof");
  });

  it("progress counts the current screen out of all of them", () => {
    expect(progress(initialFlowState("new"))).toEqual({
      current: 1,
      total: sequence(initialFlowState("new")).length,
    });
    const second = { ...initialFlowState("new"), step: "location" as const };
    expect(progress(second).current).toBe(2);
    expect(progress({ ...initialFlowState("retake") }).current).toBe(1);
  });
});

describe("next and back", () => {
  it("Next is blocked until the screen has its answer", () => {
    const state = initialFlowState("new");
    expect(canAdvance(state)).toBe(false);
    expect(goNext(state)).toBe(state);
    const withKind = setAnswer(state, "use", "house");
    expect(canAdvance(withKind)).toBe(true);
    expect(goNext(withKind).step).toBe("location");
  });

  it("the tag kind follows the home type", () => {
    const kindOf = (use: string) =>
      flowKind(setAnswer(initialFlowState("new"), "use", use as never));
    expect(flowKind(initialFlowState("new"))).toBeNull();
    expect(kindOf("house")).toBe("house");
    expect(kindOf("other")).toBe("house");
    expect(kindOf("shared_house")).toBe("apartment");
    expect(kindOf("apartments")).toBe("apartment");
    expect(kindOf("shop_below")).toBe("apartment");
  });

  it("location needs a point", () => {
    const state = {
      ...initialFlowState("new"),
      step: "location" as const,
    };
    expect(canAdvance(state)).toBe(false);
    const placed = { ...state, location: { lat: 1, lon: 2, quality: "gps" as const } };
    expect(goNext(placed)).toMatchObject({ step: "question", questionId: "floors" });
  });

  it("a question needs an answer, and 'I don't know' counts as one", () => {
    const state = atQuestions();
    expect(canAdvance(state)).toBe(false);
    const answered = setAnswer(state, "floors", "dk");
    expect(canAdvance(answered)).toBe(true);
    expect(goNext(answered)).toMatchObject({ step: "question", questionId: "basement" });
  });

  it("an optional question can be passed without an answer", () => {
    const state = { ...atQuestions({ structure: "wood" }), questionId: "size" as const };
    expect(isOptionalQuestion("size")).toBe(true);
    expect(isOptionalQuestion("floors")).toBe(false);
    expect(canAdvance(state)).toBe(true);
    expect(goNext(state)).toMatchObject({ step: "question", questionId: "people" });
    expect(goNext(state).answers.size).toBeUndefined();
  });

  it("editing from review does not force the optional questions", () => {
    const done = {
      ...atQuestions({ ...COMPLETE, size: "dk" }),
      step: "review" as const,
    };
    let state = editStep(done, { step: "question", questionId: "floors" });
    state = goNext(setAnswer(state, "floors", "f3"));
    expect(state).toMatchObject({ step: "review", editing: false });
  });

  it("changing the structure re-routes the questions that follow", () => {
    let state = atQuestions({
      use: "house",
      floors: "f2",
      basement: "none",
      age: "dk",
      builder: "dk",
    });
    state = { ...state, questionId: "structure" };
    state = goNext(setAnswer(state, "structure", "block"));
    expect(state.questionId).toBe("belts");
    state = goNext(setAnswer(state, "belts", "yes"));
    expect(state.questionId).toBe("roof");
    state = goNext(setAnswer(state, "roof", "slab"));
    expect(state.questionId).toBe("added");
  });

  it("the last question leads to photos, then review", () => {
    let state = atQuestions({ structure: "wood" });
    state = { ...state, questionId: LAST_QUESTION };
    state = goNext(state);
    expect(state.step).toBe("photos");
    expect(goNext(state).step).toBe("review");
  });

  it("a retake's last question leads straight to review", () => {
    let state = initialFlowState("retake", { structure: "wood" });
    state = { ...state, questionId: LAST_QUESTION };
    expect(goNext(state).step).toBe("review");
  });

  it("Back walks the sequence and leaves the flow at the start", () => {
    const start = initialFlowState("new");
    expect(goBack(start)).toBeNull();
    const location = { ...start, step: "location" as const };
    expect(goBack(location)?.step).toBe("kind");
    const firstQuestion = atQuestions();
    expect(goBack(firstQuestion)?.step).toBe("location");
    expect(goBack({ ...initialFlowState("retake") })).toBeNull();
    const review = { ...atQuestions(), step: "review" as const };
    expect(goBack(review)).toMatchObject({ step: "photos" });
  });
});

describe("editing from review", () => {
  it("returns to review after a change", () => {
    let state: FlowState = { ...atQuestions(COMPLETE), step: "review" };
    state = editStep(state, { step: "question", questionId: "floors" });
    expect(state).toMatchObject({
      step: "question",
      questionId: "floors",
      editing: true,
    });
    state = goNext(setAnswer(state, "floors", "f3"));
    expect(state).toMatchObject({ step: "review", editing: false });
    expect(state.answers.floors).toBe("f3");
  });

  it("asks the newly relevant questions before returning", () => {
    let state: FlowState = {
      ...atQuestions(COMPLETE),
      step: "review",
    };
    state = editStep(state, { step: "question", questionId: "structure" });
    state = goNext(setAnswer(state, "structure", "block"));
    expect(state).toMatchObject({ step: "question", questionId: "belts", editing: true });
  });

  it("changing the structure drops answers that no longer apply", () => {
    const state = setAnswer(
      atQuestions({ structure: "block", belts: "yes", roof: "slab" }),
      "structure",
      "frame",
    );
    expect(state.answers.belts).toBeUndefined();
    expect(state.answers.roof).toBeUndefined();
  });

  it("Back from an edit goes to review, not to the previous question", () => {
    const state = editStep(
      { ...atQuestions(), step: "review" as const },
      { step: "kind" },
    );
    expect(goBack(state)?.step).toBe("review");
  });
});

describe("photos", () => {
  it("keeps picked photos in slot order and removes one", () => {
    let state = initialFlowState("new");
    state = setPhoto(state, "ceiling", "file://c.jpg");
    state = setPhoto(state, "front", "file://a.jpg");
    expect(photoList(state)).toEqual([
      { uri: "file://a.jpg", slot: "front", caption: "" },
      { uri: "file://c.jpg", slot: "ceiling", caption: "" },
    ]);
    state = setPhoto(state, "front", null);
    expect(photoList(state).map((photo) => photo.uri)).toEqual(["file://c.jpg"]);
  });

  it("offers the ten suggested slots", () => {
    expect(PHOTO_SLOTS).toEqual([
      "front",
      "back",
      "left",
      "right",
      "ground",
      "roof",
      "column",
      "ceiling",
      "cracks",
      "basement",
    ]);
  });

  it("extra photos come after the slots, each with an optional trimmed caption", () => {
    let state = initialFlowState("new");
    state = addExtraPhoto(state, "x1", "file://x1.jpg");
    state = addExtraPhoto(state, "x2", "file://x2.jpg");
    state = setPhoto(state, "roof", "file://roof.jpg");
    state = setExtraCaption(state, "x1", "  crack by the door ");
    expect(photoList(state)).toEqual([
      { uri: "file://roof.jpg", slot: "roof", caption: "" },
      { uri: "file://x1.jpg", slot: "more", caption: "crack by the door" },
      { uri: "file://x2.jpg", slot: "more", caption: "" },
    ]);
    state = removeExtraPhoto(state, "x1");
    expect(photoList(state).map((photo) => photo.uri)).toEqual([
      "file://roof.jpg",
      "file://x2.jpg",
    ]);
  });

  it("stops at 30 photos per home, slots and extras together", () => {
    let state = initialFlowState("new");
    for (const slot of PHOTO_SLOTS) {
      state = setPhoto(state, slot, `file://${slot}.jpg`);
    }
    for (let i = 0; i < 25; i += 1) {
      state = addExtraPhoto(state, `x${i}`, `file://x${i}.jpg`);
    }
    expect(photoCount(state)).toBe(HOME_PHOTO_MAX_COUNT);
    expect(canAddPhoto(state)).toBe(false);
    const same = addExtraPhoto(state, "one-too-many", "file://nope.jpg");
    expect(photoCount(same)).toBe(HOME_PHOTO_MAX_COUNT);
    // a full set can still replace the photo of a slot it already has
    expect(photoCount(setPhoto(state, "front", "file://new-front.jpg"))).toBe(30);
    expect(photoList(state)).toHaveLength(30);
  });

  it("photos are optional: the photos step always allows Next", () => {
    expect(canAdvance({ ...initialFlowState("new"), step: "photos" })).toBe(true);
  });
});

describe("remarks", () => {
  it("an empty remark clears the answer; a typed one is kept", () => {
    let state = atQuestions();
    state = setAnswer(state, "remarks", "Cracks by the stairs");
    expect(state.answers.remarks).toBe("Cracks by the stairs");
    state = setAnswer(state, "remarks", "");
    expect(state.answers.remarks).toBeUndefined();
    expect(isOptionalQuestion("remarks")).toBe(true);
  });
});
