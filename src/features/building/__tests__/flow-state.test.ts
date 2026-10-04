import {
  canAdvance,
  editStep,
  goBack,
  goNext,
  initialFlowState,
  photoList,
  progress,
  sequence,
  setAnswer,
  setPhoto,
  type FlowState,
} from "../flow-state";

/** Every question answered, for a frame building. */
const COMPLETE = {
  floors: "f2",
  age: "dk",
  builder: "dk",
  structure: "frame",
  added: "no",
  openGround: "no",
  shape: "box",
  strengthened: "no",
  cracks: "none",
  pastDamage: "none",
};

function atQuestions(answers = {}): FlowState {
  return {
    ...initialFlowState("new", answers),
    step: "question",
    kind: "house",
    location: { lat: 36.19, lon: 44.01, quality: "town", townId: "erbil" },
  };
}

describe("flow sequence", () => {
  it("a new home goes kind, location, questions, photos, review", () => {
    const steps = sequence(initialFlowState("new"));
    expect(steps[0]?.step).toBe("kind");
    expect(steps[1]?.step).toBe("location");
    expect(steps[2]).toEqual({ step: "question", questionId: "floors" });
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
    const withKind = { ...state, kind: "house" as const };
    expect(canAdvance(withKind)).toBe(true);
    expect(goNext(withKind).step).toBe("location");
  });

  it("location needs a point", () => {
    const state = {
      ...initialFlowState("new"),
      step: "location" as const,
      kind: "house" as const,
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
    expect(goNext(answered)).toMatchObject({ step: "question", questionId: "age" });
  });

  it("changing the structure re-routes the questions that follow", () => {
    let state = atQuestions({ floors: "f2", age: "dk", builder: "dk" });
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
    state = { ...state, questionId: "pastDamage" };
    state = goNext(setAnswer(state, "pastDamage", "none"));
    expect(state.step).toBe("photos");
    expect(goNext(state).step).toBe("review");
  });

  it("a retake's last question leads straight to review", () => {
    let state = initialFlowState("retake", { structure: "wood" });
    state = { ...state, questionId: "pastDamage" };
    expect(goNext(setAnswer(state, "pastDamage", "none")).step).toBe("review");
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
  it("keeps picked uris in slot order and removes one", () => {
    let state = initialFlowState("new");
    state = setPhoto(state, "inside", "file://c.jpg");
    state = setPhoto(state, "front", "file://a.jpg");
    expect(photoList(state)).toEqual(["file://a.jpg", "file://c.jpg"]);
    state = setPhoto(state, "front", null);
    expect(photoList(state)).toEqual(["file://c.jpg"]);
  });
});
