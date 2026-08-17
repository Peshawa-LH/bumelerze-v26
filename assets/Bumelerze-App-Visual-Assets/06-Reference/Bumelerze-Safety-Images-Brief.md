# TASK: Illustration set for the Bumelerze Safety section (18 images)

> **How to use this document (note to the human operator):** hand this file to the same
> image-generation AI that produced the existing Bumelerze artwork. Everything the AI
> needs is inside it; no other context is required. If the tool takes one prompt at a
> time, first give it **Part 1 (the Style Bible)** as a standing system/style
> instruction, together with the character reference files named in §1.5, then feed the
> numbered prompts from **Part 2** one by one. Check the returned images against
> **Part 4** before accepting them.
>
> **Appendix A is internal.** It is a note for the app builder, not for the image AI.
> You can leave it in (it is harmless) or cut it before sending; it changes nothing
> about the images.

---

## Your commission

You are producing the illustration set for the **Safety** section of **Bumelerze**
(Kurdish _bûmelerze_ = "earthquake"), a public-safety earthquake app for the **Kurdistan
Region of Iraq**.

You (or the same production pipeline) already delivered this app's first illustration
package: 12 earthquake-intensity scenes, 10 building-damage scenes, and a cast of 10
recurring Kurdish characters, all flat 2D cartoon, warm earthy palette, transparent
background. **This new set must look like it came out of the same film on the same day.**
Continuity with that package is the single most important requirement of this
commission, ahead of every other consideration.

**What these 18 images are for.** The Safety section is a reading screen with three tabs
(Prepare / Survive / Recover) holding 15 text cards. Each image sits **inside a card as a
small illustration**, roughly 100 to 160 pixels wide on a phone, above or beside a
paragraph of text in Sorani Kurdish, Kurmanji Kurdish, Arabic, or English. They are not
buttons and nobody taps them. Their job is narrow and specific:

> **Show the thing a sentence cannot show.** A body position. A physical fixing. A
> distance. Everything that a sentence already conveys perfectly well has been
> deliberately left out of this commission.

That is why there are 18 images and not 40. Most of the safety text has no picture at
all, on purpose.

**Two constraints that shape every image:**

1. **They render over both a light and a dark card background.** The app has a light
   theme and a dark theme. The same file is used in both, over a transparent
   background. Nothing may rely on the page behind it being white.
2. **They must be direction-neutral (RTL-safe).** Two of the app's four languages read
   right to left. The app will **not** mirror your images. So no image may encode a
   left-to-right reading order: no arrows, no numbered steps, no "before on the left,
   after on the right", no sequence panels, no text of any kind.

---

## Part 1: Style Bible (applies to every image; treat as a standing instruction)

### 1.1 Art style

- **Flat 2D cartoon illustration** in the spirit of a warm, modern animated
  film / children's-book illustration, in contemporary Middle Eastern animation
  aesthetics. NOT western clip-art, NOT anime, NOT photorealism, NOT 3D render, NOT
  painterly or airbrushed.
- **Thick, clean, dark outlines** and **limited flat color fills**. No gradients, no
  drop shadows, no texture noise, no glow effects.
- Every image must still read clearly when shrunk to a **120 x 120 pixel area on a cheap
  phone screen**: one clear focal action per image, strong silhouettes, no background
  clutter competing with the main subject.
- **Warm, earthy palette**, held constant across the whole set and matching the existing
  package: ochres, terracotta, warm sand and stone tones for buildings; deep greens and
  blues as accents; skin, clothing and interiors from one small fixed set of muted
  warm-neutral colors. The finished set must read as one coherent product, not as 18
  unrelated stock images.

### 1.2 The world: Kurdistan, drawn with love

Every scene is set in the **Kurdistan Region of Iraq, present day**. This must be
visibly, recognizably Kurdistan, not a generic Middle East, and absolutely never a
US or European suburb:

- **Buildings:** reinforced-concrete frame construction with brick or block infill
  walls, or load-bearing masonry houses, always with **flat roofs**. Rooftop water
  tanks, satellite dishes, external AC units, courtyard walls with metal gates. Never a
  pitched-roof timber house, never a clip-art cottage.
- **Landscape:** the Zagros foothills, dry golden-brown hills in summer light, behind
  the towns; poplar trees; in wider scenes a distant skyline touch such as a minaret or
  a citadel silhouette reminiscent of Erbil's.
- **Interiors:** carpets and floor cushions, a wall hanging, tea served in small waisted
  glasses (_istikan_) on a tray, a glass-front dish cabinet, real Kurdish domestic
  detail rather than generic Western furniture.
- **People:** drawn only from the existing recurring cast (see §1.5). Mixed dress,
  traditional and contemporary, mixed ages; women appear both with and without
  headscarf across the set, mirroring real Kurdish streets and homes.

### 1.3 Tone and safety: absolute rules

These are carried over unchanged from the first package and are not negotiable.

- **Non-graphic at every level.** Damage happens to buildings and objects: cracks,
  fallen plaster, fallen tiles, rubble. **Never to people. No injuries, no bodies, no
  blood, ever.** Nothing may be shown striking, touching, or having struck a person.
- **No fire, no smoke, no flames, no sparks, no explosions, anywhere in any image.**
  A light dust haze is allowed where a prompt explicitly asks for it. This rule is
  absolute even in the gas-hazard images, which are exactly where a generator is most
  tempted to break it.
- **No anguish.** Faces show concentration, alertness, calm, or mild uncertainty; never
  terror, screaming, panic, or pain. The overall register is a serious, restrained
  public-information illustration, not a disaster-movie poster.
- **No text of any kind in the image:** no numerals, letters, logos, readable signage,
  labels, or watermarks. The app draws its own captions in four languages; baked-in text
  would be wrong in three of them.
- **No symbols or marks either** (this is additional to the first package, and matters
  here): no ticks, crosses, red circles with a slash, warning triangles, arrows,
  highlight rings, zone hatching, or step numbers. The app already draws a green tick
  next to correct actions and a red cross next to incorrect ones. A symbol inside the
  picture would be a duplicate and would turn to mush at small size.

### 1.4 Legibility over light AND dark backgrounds

Each image is composited over the app's card surface, which is near-white in light theme
and near-black in dark theme.

- Outlines dark and high-contrast, but the **interior fills of the subject must stay in
  the mid-tone warm range**. A subject filled with near-black disappears against a dark
  card.
- Dim or night scenes (the bedroom, the stairwell, the dim kitchen) are indicated by
  **cooler and slightly desaturated fills**, never by darkening toward black.
- No white halo, white outline, or white background plate around the subject.

### 1.5 Continuity with the existing set (read this before drawing anything)

The delivered package lives at `assets/Bumelerze-App-Visual-Assets/`. Use these files as
style and character references in your tool's reference-image / style-consistency
feature. Every person in this new set must be **one of these ten existing characters**,
recognizably the same person: same face, same build, same hair, same clothing, same
colors. Do not invent new-looking people.

| Reference file (`01-Characters/`)           | Who they are                                |
| ------------------------------------------- | ------------------------------------------- |
| `character-01-older-man-traditional.png`    | Older man, traditional Kurdish dress        |
| `character-02-woman-traditional.png`        | Woman, traditional Kurdish dress            |
| `character-03-woman-modern.png`             | Younger woman, contemporary clothing        |
| `character-04-man-modern.png`               | Man, contemporary clothing                  |
| `character-05-boy-traditional.png`          | Boy, traditional Kurdish dress              |
| `character-06-elderly-woman.png`            | Elderly Kurdish woman                       |
| `character-07-young-man-traditional.png`    | Young man, traditional Kurdish dress        |
| `character-08-teen-girl-traditional.png`    | Teenage girl, traditional Kurdish dress     |
| `character-09-school-girl-modern.png`       | School-age girl, contemporary clothing      |
| `character-10-bearded-man-traditional.png`  | Bearded man, traditional Kurdish dress      |

Each prompt in Part 2 names which character to use. Follow those assignments; they are
spread deliberately so no single face dominates the section.

For **environments**, use the existing intensity scenes (`02-Intensity-Levels/`) and
building-damage scenes (`03-Building-Damage/`) as the reference for what a Bumelerze
living room, kitchen, stairwell, street, and rooftop look like. The apartment interiors
in this set should read as the same apartments; the flat-roofed house and the
concrete-frame block should read as the same buildings.

### 1.6 How correct and incorrect actions are drawn

Eight of these images depict an **incorrect** action, because the wrong action is the
one people reach for by instinct and showing it is the whole point. There are firm rules
for how they are drawn:

1. **One image is always one single continuous scene.** Never split the square into two
   panels, never put a correct version and an incorrect version side by side in the same
   file. At the size these render, a split panel is two illegible pictures instead of
   one clear one. The app pairs the files itself, stacked vertically, which is also what
   keeps them safe for right-to-left layouts.
2. **The environment carries the warning, not a symbol.** In an incorrect-action image,
   the hazard the person has just exposed themselves to is visible in the same scene:
   the cracked lintel over the doorway, the facade pieces coming down on the pavement,
   the dark elevator shaft, the concrete dust falling off the underside of the overpass
   deck. It is present and legible, and it never touches anyone.
3. **Never make the wrong action look appealing.** The person taking it is drawn upright
   and unprotected, ordinary, slightly uncertain, never confident, heroic, relaxed,
   sheltered, or cozy. No warm pool of light around them, no reassuring composition.
4. **The correct-action images get the better picture.** Warmer light, the clearer focal
   subject, the calmer and more capable posture. When a correct image and an incorrect
   image belong to the same pair, they share viewpoint, framing style, and palette so
   they read as siblings, and the correct one is the more attractive of the two.
5. **Nobody is ever harmed, in either kind of image.** See §1.3.

### 1.7 Recommended workflow

1. Load the ten character files and two or three existing scene files as style
   references before generating anything.
2. Generate one test image first (start with image 1, Drop-Cover-Hold-On), confirm the
   style and palette match the existing package, and only then generate the rest with
   the same seed / style settings.
3. Generate every image **large** (see Part 3), never at final display size.
4. Preview each one at 120 x 120 pixels over both a near-white and a near-black
   background before accepting it.

---

## Part 2: The eighteen images

Each entry gives the scene, then **"Must teach"**, the one thing the picture exists to
convey. If the drawing does not make that one thing unmistakable at small size, the
image has failed regardless of how good it looks. The full Style Bible applies to every
prompt.

### Group A: the protective postures (5 images)

These five are the heart of the commission. Body position is precisely what prose is
worst at and a picture is best at, and these are the actions a person has three seconds
to get right.

---

#### Image 1: `safety-drop-cover-hold.png` (correct action)

A Kurdish living room in calm daytime light: patterned carpet, a wall hanging, a
glass-front dish cabinet standing well off to one side. **Character-03 (younger woman,
contemporary clothing)** is down on her hands and knees **completely underneath a sturdy
wooden table**, her whole body inside the table's footprint, head lowered. **One hand
grips a table leg**; her other forearm is across the back of her head and neck. The
ceiling lamp above swings in a small arc; two books have slid off a low shelf onto the
carpet nearby, clear of her. View from floor level, side-on and slightly low, so the
"underneath the table" relationship is unmistakable in silhouette.

**Must teach:** the body is entirely under the table, one hand is holding a leg so the
table can be followed if it shifts, and the head and neck are covered. Keep the tabletop
line and her body clearly separated in silhouette so all three read at 120 pixels.

---

#### Image 2: `safety-cover-head-neck.png` (correct action)

The same apartment, in a stretch of interior wall or corridor with no furniture along
it. **Character-04 (man, contemporary clothing)** is kneeling low against that interior
wall, knees tucked under him, torso folded forward, **both forearms crossed over the
back of his head and neck with the elbows drawn in against his ears**. He is visibly
away from a window on the far side of the room and away from a tall wardrobe further
down. Nothing is falling on him and nothing has hit him.

**Must teach:** the fold-down posture with both forearms protecting the head and neck,
used when there is no table, and the choice of an interior wall away from glass and tall
furniture. This posture is the building block of images 3, 4, and 10, so keep it
identical in all four.

---

#### Image 3: `safety-wheelchair.png` (correct action)

The same living room. **Character-06 (elderly Kurdish woman)**, keeping her face, hair
covering, and dress exactly as in the reference, is seated in a modern manual wheelchair.
**Both wheel brakes are clearly engaged**, the brake levers pressed against the tyres and
drawn large and unmistakable. She stays seated and **leans forward over her lap**; one
arm is over the back of her head and neck, and her other hand holds a small cushion
against the back of her head. Her chair is positioned away from the window and away from
a tall unsecured cabinet, both visible elsewhere in the room.

**Must teach:** brakes locked (make the levers the second-most readable thing in the
image), lean forward over the lap, head and neck covered, stay seated rather than
transfer.

---

#### Image 4: `safety-cane-walker.png` (correct action)

The same living room. **Character-01 (older man, traditional Kurdish dress)** has sat
down on a **sturdy wooden chair**, feet flat on the carpet, torso leaned slightly
forward, **both forearms over the back of his head and neck** in the same posture as
image 2. His walking cane leans against the side of the chair within arm's reach, and a
walker stands just behind the chair. He is not reaching for either of them and is not
standing.

**Must teach:** sit down on the nearest sturdy seat instead of staying on your feet,
cover head and neck, and leave the mobility aid where it is until the shaking stops.
Keep the cane and walker small and clearly secondary so they do not compete with the
posture.

---

#### Image 5: `safety-in-bed.png` (correct action)

A Kurdish bedroom at night. Follow §1.4 for the dim look: cooler, slightly desaturated
fills, not darkened toward black, with one warm bedside lamp for orientation.
**Character-04 (man, contemporary clothing)** is **lying face down in the bed**, blanket
still over him, **holding a pillow over the back of his head and neck with both hands**.
He is staying put. The wall above the headboard is deliberately bare: no framed picture,
no shelf, nothing hanging over the bed. A tall wardrobe stands across the room, well
clear of the bed.

**Must teach:** stay in bed, turn face down, pillow over head and neck, do not get up in
the dark to look for cover. The empty wall above the headboard is part of the lesson;
keep it visibly, deliberately empty.

---

### Group B: the intuitive wrong actions (4 images)

Every image in this group depicts an **incorrect** action. Re-read §1.6 before drawing
any of them. No ticks, no crosses, no red marks, no warning symbols inside the picture.

---

#### Image 6: `safety-dont-doorway.png` (incorrect action)

The same Kurdish apartment, shaking in progress. **Character-07 (young man, traditional
Kurdish dress)** stands **upright inside an interior doorway**, back against one jamb,
both hands gripping the frame, his whole body exposed from head to foot. Above him a
**fine crack runs across the plaster of the lintel** and a few small plaster flakes are
coming loose from it. Beside the doorway, an unsecured tall shelf is tilting and small
objects are sliding off it toward the open floor near his feet. His expression is
uncertain: not calm, not terrified. Nothing has struck him and nothing touches him.

**Must teach:** a doorway in a modern building is not a shelter. Standing in it leaves
the head and neck completely unprotected while the frame itself is just more plastered
wall. Draw him tall and unshielded, in the same neutral register as the rest of the set.

---

#### Image 7: `safety-dont-run-outside.png` (incorrect action)

Street level outside a Kurdish concrete-frame apartment building with block infill
walls, flat roof, rooftop water tank and satellite dishes. **Character-03 (younger
woman, contemporary clothing)** is **mid-stride through the ground-floor doorway onto the
pavement**, arms raised, still directly under the edge of the building. Along the facade
above and around her, a pane of window glass, a piece of broken parapet, and a roof tile
are falling through the air; on the pavement below, a few pieces have already landed.
Everything falling is well clear of her body: nothing hits her, nothing touches her.

**Must teach:** the strip of pavement immediately outside the door is exactly where
facade pieces land, so running out during shaking moves you into the fall zone rather
than out of it. The relationship between the falling pieces and the narrow strip of
pavement she has stepped into is the whole image.

---

#### Image 8: `safety-dont-elevator.png` (incorrect action)

A lift lobby inside a Kurdish concrete-frame apartment building, after the shaking has
stopped. **Character-04 (man, contemporary clothing)** is **reaching toward the elevator
call panel** with one hand. The elevator doors are **jammed partly open onto an empty
dark shaft**; the wall beside them carries a diagonal crack with a little fallen plaster
on the floor beneath it. The ceiling light is out, so the lobby is lit by daylight from a
window at the end of the corridor: keep the palette readable per §1.4. To one side, a
**stairwell door stands open and unused**, plainly available. Nobody is in or near the
shaft, and nothing is falling.

**Must teach:** after an earthquake the elevator may be unpowered, jammed, or opening
onto a damaged shaft, while the stairwell right beside it is fine. The open stairwell
door must be clearly visible so the alternative is obvious.

---

#### Image 9: `safety-dont-overpass.png` (incorrect action)

A road at the edge of a Kurdish town, dry golden Zagros hills behind. A small car has
**stopped directly beneath a concrete road overpass**, the driver still inside. From the
**underside of the concrete deck above**, a few small chunks of concrete and a little
light dust are falling away, and one support column shows a diagonal crack. The road on
both sides of the overpass is open, clear, and deliberately drawn as visibly available.
No collision, no crushed car, nothing striking the vehicle, no smoke, no flames. Draw
the car in three-quarter view so the composition does not read as an arrow pointing one
way.

**Must teach:** the overpass is the structure most likely to shed pieces, and the open
road a few metres away was there the whole time. The falling concrete from the deck
directly above the roof of the car is the key relationship.

---

### Group C: where to be (2 images)

---

#### Image 10: `safety-outdoors-open-ground.png` (correct action)

An open area in a Kurdish town: bare ground, a couple of poplar trees set well back,
low flat-roofed buildings in the middle distance, Zagros foothills behind.
**Character-10 (bearded man, traditional Kurdish dress)** and **character-09 (school-age
girl, contemporary clothing)** are **down low in the open**, knees bent, forearms over
the backs of their heads and necks, in the same posture as image 2. There is a
**generous, visibly empty distance between them and everything vertical**: the nearest
building facade is well away with a few fallen roof tiles lying at its base, and a power
line pole with its wires is well off to the other side. Nothing overhangs them: no wall,
no tree, no pole, no wires.

**Must teach:** the size of the gap matters, and debris lands at the base of buildings,
not out in the open. Keep the empty ground around the two figures generous; that
emptiness is the lesson, so do not fill it with detail.

---

#### Image 11: `safety-vehicle-pull-over.png` (correct action)

The same road as image 9, shaking in progress. A small car is **pulled fully onto a
clear open shoulder**, with an overpass and a line of power poles both visible far in the
background, well away from it. **Character-03 (younger woman, contemporary clothing)** is
in the driver's seat, **seatbelt drawn clearly across her chest**, hands resting on the
wheel, waiting calmly, staying inside the car. Three-quarter rear-side view of the car.
Hazard lights may be suggested with small motion marks only: no glow, no light beams.

**Must teach:** pull over onto clear open ground away from anything overhead, and stay
seated and belted inside the car rather than getting out. The seatbelt across the chest
and the empty sky above the car are the two things that must read at small size.

---

### Group D: after the shaking stops (3 images)

---

#### Image 12: `safety-use-stairs.png` (correct action)

A concrete stairwell in a Kurdish apartment building, daylight coming in through a
landing window. **Character-02 (woman, traditional Kurdish dress)** and **character-05
(boy, traditional Kurdish dress)** are **walking down the stairs together at a steady
pace**, each with **one hand on the handrail**, both looking down at the steps in front
of them. On one step lie a few pieces of fallen plaster and the shards of a broken pane,
clearly visible and clearly being stepped around. Nobody is running, nobody is carrying a
large load, nobody is crowding anybody.

**Must teach:** leave a damaged building on foot, calmly, holding the handrail, watching
the steps for glass and fallen material. The hand on the handrail and the debris on the
step are the two required details.

---

#### Image 13: `safety-gas-leak-response.png` (correct action)

A Kurdish kitchen. **Character-03 (younger woman, contemporary clothing)** is **closing
the valve on top of an upright gas cylinder with one hand** while her other hand
**pushes a window open** beside her. Thin wavy vapor lines rise from around the cylinder
valve and drift toward the open window. The cooker is off and stands clearly apart from
the cylinder. **Absolutely no flame, no spark, no lighter, no match, no smoke, no glow,
nothing burning, anywhere in this image.** Her expression is purposeful and unhurried.

**Must teach:** which valve to close (draw the cylinder's top valve large and
unambiguous) and that the window goes open as part of the same action. The two hands
doing two things, valve closed and window opened, is the composition.

---

#### Image 14: `safety-dont-spark.png` (incorrect action)

The same kitchen, dimmer per §1.4. **Character-04 (man, contemporary clothing)** is
**reaching a finger toward the wall light switch** by the door, in the completely
ordinary way anyone does when entering a dim room. Behind him, the same **thin wavy vapor
lines rise from the valve of an upright gas cylinder** and spread through the room. The
light is off, the room is dim but fully readable. His posture is casual and unaware, not
dramatic. **Absolutely no flame, no spark, no arc, no lighter, no match, no smoke, no
glow, no explosion, nothing burning, anywhere in this image.** Do not draw the
consequence; draw the moment before it, and nothing more.

**Must teach:** the completely automatic reflex of reaching for a light switch is itself
the hazard when there is gas in the air. The unremarkable, everyday quality of the
gesture is the point.

---

### Group E: preparing the home (4 images)

These are calm daytime scenes with no shaking anywhere in them. They exist because the
fixings and the layouts they show are things people cannot picture from a description
and would not recognize as "done properly" without seeing one.

---

#### Image 15: `safety-secure-furniture.png` (correct action)

A Kurdish bedroom in calm daylight, nothing shaking. A **tall wardrobe** (or a tall
bookshelf) stands against the wall and is **fixed to it with two clearly drawn metal
L-brackets and a strap across the top**. Draw the fixing hardware oversized enough to
read at small size; it is the subject of the image, not a detail. **Heavy items sit on
the lowest shelves** (a stack of thick books, a metal box) and light items are above.
The bed is placed away from the wardrobe, in a position where nothing from it could land
on someone sleeping.

**Must teach:** what "anchored to the wall" physically looks like, plus heavy-low and
light-high, plus keeping the bed out of the fall line. The brackets are the focal point.

---

#### Image 16: `safety-secure-water-tank.png` (correct action)

The **flat roof of a Kurdish house** in calm daylight, low parapet, a satellite dish,
golden Zagros hills behind. The **rooftop water tank** sits on a proper welded steel
stand whose **feet are bolted down to the roof slab**, and **two metal straps run over
the tank body and fasten to the stand**. The bolts at the stand feet and the straps over
the tank must be the clearly readable focus of the image. **Character-10 (bearded man,
traditional Kurdish dress)** stands beside it, checking one strap by hand, giving the
tank its scale.

**Must teach:** a rooftop tank must be strapped to a stand and the stand must be bolted
down, not simply resting on loose blocks. Someone who has only ever seen an unsecured
tank should be able to see the difference from this picture alone.

---

#### Image 17: `safety-secure-gas-cylinder.png` (correct action)

A Kurdish kitchen corner in calm daylight. A **gas cylinder stands fully upright on
level floor**, with a **metal strap or chain around its body fixed to the wall behind it
through a clearly drawn plate and bolts**. It stands **well clear of the cooker**, with
visibly empty floor between the two. Nothing is stacked on it and nothing leans against
it. The cooker is off. **No flame anywhere in this image.**

**Must teach:** upright, strapped to the wall, and set apart from any heat source, all
three at once. The strap-to-wall fixing and the gap of empty floor between cylinder and
cooker are the two required details.

---

#### Image 18: `safety-safe-spot-room.png` (correct action)

**One** Kurdish living room seen from an **elevated three-quarter angle with the near
wall removed**, like a small open stage set. Calm daylight, nobody in the room, nothing
shaking. Within that one continuous space, arranged so the contrast is obvious:

- the **safe places**, drawn in the set's normal warm palette and holding the visual
  focus: a sturdy low table on the carpet with clear floor under it, and a stretch of
  interior wall with clear floor in front of it;
- the **places to keep away from**, present but pushed toward the edge of the
  composition, smaller and cooler in tone: a large window, a wall mirror, and a tall
  unsecured cabinet full of glassware.

**Must teach:** a room can be read in advance as safe places and hazard places. **Draw no
zones, circles, arrows, hatching, dotted lines, marks, or symbols of any kind**; the
arrangement, the warmth, and the focus have to carry it entirely. This is the one image
where a generator will be tempted to add diagram marks. It must not.

---

### What is deliberately NOT illustrated (do not add these)

For the operator's information, so that a gap does not look like an oversight. The
Safety section has 15 text cards; 9 of them get no image at all, because in each case a
picture would restate the sentence rather than add to it:

- **Make a family plan** (agreeing on meeting points): the content is a decision, and
  the specifics are different for every family.
- **Prepare an emergency kit** (water, medicine, documents, torch, cash): a list of many
  small objects, which is exactly the kind of image that turns to noise at 120 pixels,
  and half the items would need readable labels to be identifiable, which the no-text
  rule forbids.
- **Know the plan at school and work**: an organizational action, not a physical one.
- **Expect aftershocks**: a statement about time. Any image would just repeat image 1.
- **Get information from reliable sources**: depicting rumour versus verified information
  requires readable text on a screen, which is forbidden and would not translate.
- **Help others if you safely can**: the "do not move a seriously injured person" half
  cannot be drawn at all without breaking the no-injuries rule, and the other half (a
  knock on a neighbour's door) teaches nothing.
- **Do not go back inside until it is checked**: a decision, not a posture.
- The "correct action" halves of several pairs, which are already covered by images 1,
  10, 11, 12, and 13 and are reused rather than re-drawn.

---

## Part 3: Technical delivery specification

| Requirement | Value                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format      | **PNG** (RGBA)                                                                                                                                                         |
| Canvas      | **Square**, minimum 1024 x 1024 px. **1254 x 1254 preferred**, matching the masters of the existing package exactly so both sets downscale identically.                 |
| Background  | **Fully transparent** alpha channel. No white or colored background box, no rounded plate, no frame. The app composites each image over its own card surface.           |
| Outlines    | Dark and high-contrast; subject interiors mid-tone. Each image must stay readable over BOTH a near-white and a near-black card (see §1.4).                              |
| Safe margin | Keep the main subject inside the **center ~85%** of the square.                                                                                                        |
| Text        | **None**, in any image.                                                                                                                                                |
| Symbols     | **None**: no ticks, crosses, arrows, warning marks, zone outlines, or step numbers (see §1.3).                                                                          |

**Exact filenames (18 files):**

```
safety-drop-cover-hold.png
safety-cover-head-neck.png
safety-wheelchair.png
safety-cane-walker.png
safety-in-bed.png

safety-dont-doorway.png
safety-dont-run-outside.png
safety-dont-elevator.png
safety-dont-overpass.png

safety-outdoors-open-ground.png
safety-vehicle-pull-over.png

safety-use-stairs.png
safety-gas-leak-response.png
safety-dont-spark.png

safety-secure-furniture.png
safety-secure-water-tank.png
safety-secure-gas-cylinder.png
safety-safe-spot-room.png
```

Lower-case, hyphenated, exactly as written. Do not add numeric prefixes; the app maps
these files by name.

---

## Part 4: Acceptance checklist (run per image before delivering)

1. ☐ Flat 2D cartoon, thick dark outlines, flat fills. No gradients, no 3D, no
   photorealism, no drop shadows.
2. ☐ Every person is recognizably **one of the ten existing characters**, and it is the
   character the prompt asked for.
3. ☐ Palette, line weight, and world match the existing package; placed next to a file
   from `02-Intensity-Levels/` it looks like the same production.
4. ☐ Recognizably Kurdistan: flat roofs, concrete-and-block or masonry construction,
   rooftop water tanks, Kurdish dress and domestic detail. Nothing Western-suburban.
5. ☐ Zero injuries, bodies, blood, or anguished faces. Nothing is shown striking or
   having struck a person.
6. ☐ Zero fire, smoke, flames, sparks, or explosions, including in images 13, 14, and 17.
7. ☐ Zero text, numerals, logos, or watermarks.
8. ☐ Zero ticks, crosses, arrows, warning symbols, zone marks, or step numbers.
9. ☐ Single continuous scene; not split into panels, and no before/after arrangement
   that only works read in one direction.
10. ☐ For the eight incorrect-action images: the person is upright and unprotected, the
    hazard is visible in the same scene, the pose is not confident or comfortable, and
    the correct-action image of the same pair is still the more attractive picture.
11. ☐ The **"Must teach"** line for this image is unmistakable when the image is
    previewed at **120 x 120 px** (squint test: is the posture / fixing / distance still
    the first thing you see?).
12. ☐ Readable over both a near-white and a near-black background; no near-black subject
    fills, no white halo.
13. ☐ Transparent background, subject inside the center 85%, square, at least 1024 px.
14. ☐ The file carries the exact filename from Part 3.

---

## Appendix A: Integration note (internal; not part of the image commission)

For the builder wave that wires these files in, once they are delivered and approved.

### A.1 Where each file goes

Content ids below are from `src/features/safety/content.ts`; text keys are under
`safety.cards.*` in the four locale catalogs.

| File                              | Section  | Card               | Slot                                                                                                     |
| --------------------------------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------------- |
| `safety-drop-cover-hold.png`      | survive  | `dropCoverHold`    | card illustration (`body1`); reused as the **do** row of `protectHeadNeckVsDoorway`, `headNeckVsDoorwayMyth` (card `commonMyths`), and `stayInVsRunOutside` (card `indoors`) |
| `safety-cover-head-neck.png`      | survive  | `dropCoverHold`    | secondary card illustration (`body2`, the "no table nearby" fallback)                                     |
| `safety-wheelchair.png`           | survive  | `dropCoverHold`    | accessibility variant `wheelchair`                                                                        |
| `safety-cane-walker.png`          | survive  | `dropCoverHold`    | accessibility variant `caneOrWalker`                                                                      |
| `safety-in-bed.png`               | survive  | `dropCoverHold`    | accessibility variant `bed`                                                                               |
| `safety-dont-doorway.png`         | survive  | `dropCoverHold`    | **dont** row of `protectHeadNeckVsDoorway`; reused for the **dont** row of `headNeckVsDoorwayMyth` (`commonMyths`) and as the illustration for `safeSpots` `body2` in PREPARE |
| `safety-dont-run-outside.png`     | survive  | `indoors`          | **dont** row of `stayInVsRunOutside`                                                                      |
| `safety-outdoors-open-ground.png` | survive  | `outdoors`         | **do** row of `openGroundVsBuildings` (also serves as the card illustration)                              |
| `safety-vehicle-pull-over.png`    | survive  | `vehicle`          | **do** row of `pullOverVsOverpass`                                                                        |
| `safety-dont-overpass.png`        | survive  | `vehicle`          | **dont** row of `pullOverVsOverpass`                                                                      |
| `safety-use-stairs.png`           | survive  | `commonMyths`      | **do** row of `stairsVsElevator`; reused as the card illustration for `evacuateCarefully` in RECOVER      |
| `safety-dont-elevator.png`        | survive  | `commonMyths`      | **dont** row of `stairsVsElevator`                                                                        |
| `safety-gas-leak-response.png`    | recover  | `checkHazards`     | **do** row of `gasLeakSafety`                                                                             |
| `safety-dont-spark.png`           | recover  | `checkHazards`     | **dont** row of `gasLeakSafety`                                                                           |
| `safety-secure-furniture.png`     | prepare  | `secureHome`       | card illustration (`body1`)                                                                               |
| `safety-secure-water-tank.png`    | prepare  | `secureHome`       | card illustration (`body2`, first of the two regional hazards)                                            |
| `safety-secure-gas-cylinder.png`  | prepare  | `secureHome`       | card illustration (`body2`, second regional hazard)                                                       |
| `safety-safe-spot-room.png`       | prepare  | `safeSpots`        | card illustration (`body1`)                                                                               |

Cards that stay image-free by design: `familyPlan`, `emergencyKit`, `schoolWork`,
`aftershocks`, `reliableInfo`, `helpNeighbors`, plus the `reentryCaution`,
`verifyBeforeSharing`, and `helpSafely` pairs. See the "What is deliberately NOT
illustrated" section for the reasoning; that list is the record, not an omission to
fix later.

### A.2 Wiring pattern

Mirror what already exists for the felt-report artwork, do not invent a second pattern:

- **Prop shape:** add an optional `imageSource?: ImageSource` (from `expo-image`) exactly
  as `src/features/felt/components/LevelTile.tsx` and `DamageTile.tsx` already declare
  it. Optional is load-bearing: with the prop absent, `SafetyCard`, `DoDontPairRow`, and
  `AccessibilityDisclosure` must render exactly as they do today, so the wave can land
  card by card.
- **Require map:** add `src/features/safety/artwork.ts` mirroring
  `src/features/felt/artwork.ts`, requiring straight out of the committed asset package
  rather than copying files elsewhere. Every `require()` argument must be a **plain
  string literal**; Metro's static dependency collector will not follow an interpolated
  or constant-built path, and the failure is silent at runtime. That is why the felt map
  is written out by hand, and this one has to be too.
- **Format:** prefer the **WebP-512** variants for the same reason the felt map does
  (lossless, roughly 30 percent smaller than PNG-512, decoded natively by `expo-image`
  on both platforms), which matters on the low-end Android baseline. That means the
  delivered PNG masters need the same resize/convert pass the first package went
  through, producing `05-App-Ready/Visuals/` variants alongside the existing ones.
- **Accessibility:** these images are **decorative reinforcement only**. Set
  `accessibilityElementsHidden` and `importantForAccessibility="no-hide-descendants"` on
  the `Image`, exactly as `LevelTile` does. The card text and the existing
  `Do:` / `Don't:` accessibility labels in `DoDontPairRow` already carry the full
  meaning, and a screen reader must not have to walk past an unlabelled image to reach
  the safety instruction.
- **RTL:** never mirror these images (`transform: [{ scaleX: -1 }]` or any equivalent).
  The brief guarantees direction-neutral meaning, so the layout flips around them while
  each picture stays as drawn.

### A.3 One content-model change required

`SafetyDoDontPair` currently carries a single `iconPlaceholder?: string`, which assumed
one image per pair. Six of the eight pair-attached files above are per-row, so the field
needs to become two optional fields (for example `doImage?` / `dontImage?`), and
`safetyDoDontKeys`-style helpers should get an artwork sibling so the file mapping lives
in one place. Update `src/features/safety/__tests__/content.test.ts` alongside it: the
content-integrity test should assert that every declared artwork key resolves to a real
entry in the require map, which is the same guard `felt/__tests__/artwork.test.ts`
provides for the off-by-one in the damage grades.
