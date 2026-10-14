import ar from "@/i18n/locales/ar.json";

/**
 * i18next looks up `key_<form>` and then the bare `key`; when an Arabic
 * catalog only carries `_one/_other`, counts of 0, 2, 3-10 and 11-99 fall
 * through to ENGLISH (review 2026-10-14). Every plural stem in ar must carry
 * all six CLDR forms (machine drafts may copy `_other`).
 */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
    }
  } else if (typeof value === "string") {
    out[prefix] = value;
  }
  return out;
}

const FORMS = ["zero", "one", "two", "few", "many", "other"] as const;

test("every Arabic plural stem carries all six CLDR forms", () => {
  const keys = Object.keys(flatten(ar));
  const stems = new Set<string>();
  for (const key of keys) {
    const match = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
    if (match) stems.add(match[1] as string);
  }
  const incomplete = [...stems].filter((stem) =>
    FORMS.some((form) => !keys.includes(`${stem}_${form}`)),
  );
  expect(incomplete).toEqual([]);
});
