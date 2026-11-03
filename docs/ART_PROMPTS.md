# Artwork prompts (Higgsfield)

Seven images give the home page a hand-made look: one hero backdrop and one piece per game card.
The site picks them up automatically once the files are in `assets/art/` (see the table at the end).

## Settings

- Model: through the API, **Recraft V4.1 Pro** (`recraft/v4.1/pro/text-to-image`, resolution 2k) made the current set; `scripts/generate-art.ts` runs all seven. In the Higgsfield app, Nano Banana Pro or FLUX.2 (pro) also work. Avoid the Soul models: they are tuned for people and fashion.
- One image per prompt. Generate two or three variations and keep the best.
- Keep the **style line** identical across all seven so they read as one set.

**Style line (paste at the end of every prompt):**

> Hand-painted editorial illustration, flat shapes with soft gouache texture and visible paper grain, limited palette of deep navy, cobalt blue, warm orange and a touch of red, soft rim light, cinematic composition, no text, no letters, no logos, no watermark, no people's faces.

## 1. Hero backdrop — `hero.jpg` — aspect **2:1** (21:9 where offered)

> A wide dusk landscape seen from a quiet hilltop: a long road with glowing blue lane lines winding toward a small town of warm-lit houses, a big low orange sun behind blocky mountains, a few stars above. Calm, spacious, most detail on the right third, the left third kept dark and simple for text.

## 2. Energy Run — `card-platformer.jpg` — aspect **4:3**

> A small running figure, seen from the side and far away, leaping between floating stone platforms above a misty canyon at dusk, a trail of orange energy sparks behind it, a tall gate of blue light on the far platform.

## 3. Spell Forge — `card-spell.jpg` — aspect **4:3**

> A blacksmith's anvil on a dark workbench, struck by a hammer, orange sparks flying up and cooling into small glowing blue marks in the air, warm forge light from the left, deep navy shadows.

## 4. Accent Hunter — `card-accent.jpg` — aspect **4:3**

> A brass magnifying glass lying on a sheet of aged cream paper with faint handwritten lines, the lens magnifying a single small glowing orange mark, soft shadow, warm desk lamp light from the top left.

## 5. Word Rain — `card-blaster.jpg` — aspect **4:3**

> A night city skyline of simple blocky towers with warm windows, three meteors with long orange tails falling from a deep blue sky, a thin blue beam of light rising from a small dome on the ground to meet one of them.

## 6. Memory Deck — `card-flash.jpg` — aspect **4:3**

> A fan of five blank playing cards on a dark wooden table, one card turned over to show a bright orange sun motif, soft blue rim light along the card edges, a small cup of coffee at the corner, warm and quiet.

## 7. Word Highway — `card-highway.jpg` — aspect **4:3**

> A low blocky sports car with a red spoiler, seen from behind, driving down a straight road toward a big orange sun, blocky green plains and distant blocky towers on both sides, glowing blue road edges, light motion blur on the ground.

## Getting the images into the site

Two ways, whichever is easier:

1. **Download and drop in.** Save each result as a JPG with the exact file name from the table below, into `assets/art/`, and commit. Nothing else to change.
2. **Let Claude fetch them.** Generate in Higgsfield, then say which result is which; the connector can read the result URLs from your Higgsfield history and the files get saved into `assets/art/` for you.

| File | Aspect | Used for |
|---|---|---|
| `hero.jpg` | 2:1 | home hero backdrop |
| `card-platformer.jpg` | 4:3 | Energy Run card |
| `card-spell.jpg` | 4:3 | Spell Forge card |
| `card-accent.jpg` | 4:3 | Accent Hunter card |
| `card-blaster.jpg` | 4:3 | Word Rain card |
| `card-flash.jpg` | 4:3 | Memory Deck card |
| `card-highway.jpg` | 4:3 | Word Highway card |

Keep each JPG under about 400 KB (quality 80 is plenty). The page falls back to the gradient cards for any file that is missing.
