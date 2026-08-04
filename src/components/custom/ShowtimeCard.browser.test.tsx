import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { Movie, Session, Theatre } from "@/lib/cineplex/types";
import { ShowtimeCard } from "./ShowtimeCard";

/*
 * The card's height and the poster's shape, neither of which happy-dom can see
 *
 * Two things went wrong here before. A full-width 3:4 poster at the page's column is
 * 939px tall and the card led the page; cropping it to a 21:9 band made the card short by
 * zooming into the middle of the artwork. Both look identical to a class-name assertion
 */

const movie: Movie = {
  id: 37997,
  name: "Spider-Man: Brand New Day",
  runtimeInMinutes: 145,
  genres: [],
  releaseDate: "2026-07-31",
  // A real 320x470, the shape Cineplex serves, drawn as a solid so the box is measurable
  posterUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='470'%3E%3Crect width='320' height='470' fill='%23cb8e4a'/%3E%3C/svg%3E",
  isNowPlaying: true,
  isComingSoon: false,
};

const theatre: Theatre = {
  id: 7249,
  name: "Galaxy Cinemas Barrie",
  city: "Barrie",
  province: "ON",
  latitude: 0,
  longitude: 0,
  distanceMeters: null,
};

const session: Session = {
  sessionId: 326227,
  auditorium: "Aud 12",
  start: "2026-08-02T18:45:00",
  experiences: [],
  seatsRemaining: 10,
  isSoldOut: false,
};

/** The content width of `Container size="narrow"` at a desktop viewport: 768 minus lg:px-8 */
const COLUMN = 704;

const draw = (props: { theatre: Theatre | null; session: Session | null }) =>
  render(
    <div style={{ width: `${COLUMN}px` }}>
      <ShowtimeCard movie={movie} {...props} />
    </div>,
  );

test("the whole poster fits, at a size the card can carry", async () => {
  const screen = await draw({ theatre, session });
  await expect.element(screen.getByText(movie.name)).toBeVisible();

  const frame = screen.container.querySelector('[data-slot="aspect-ratio"]') as HTMLElement;
  const box = frame.getBoundingClientRect();
  // 96px wide at the poster's own 320:470, so nothing is cropped to make it fit
  expect(box.width).toBe(96);
  expect(Math.round(box.height)).toBe(Math.round(96 / (320 / 470)));

  /*
   * ...and the image fills that frame rather than overflowing it. `object-contain` is
   * what makes a poster of some other shape letterbox instead of zooming, which is the
   * failure the crop had
   */
  const poster = frame.querySelector("img") as HTMLImageElement;
  const rendered = poster.getBoundingClientRect();
  expect(rendered.width).toBeLessThanOrEqual(box.width);
  expect(rendered.height).toBeLessThanOrEqual(box.height + 1);
});

test("the card is short enough not to lead the page", async () => {
  const screen = await draw({ theatre, session });
  await expect.element(screen.getByText(movie.name)).toBeVisible();

  const card = screen.container.querySelector('[data-slot="card"]') as HTMLElement;
  const height = card.getBoundingClientRect().height;
  // A full-width 3:4 poster alone would be 939px here, so this is the number that matters
  expect(height).toBeLessThan(250);
  // ...and not so short that the poster was quietly dropped
  expect(height).toBeGreaterThan(140);
});

/*
 * The padding comes from the primitive's own size axis, not from utilities on the card
 *
 * A range cannot see this: the bounds above are satisfied at either size, so the card sat
 * unpinned at `py-6` while every test stayed green. `size="sm"` is 16px on all four edges
 * against 24, which is 16px off the card's height and 16px off its content width
 */
test("the card carries the small size's padding", async () => {
  const screen = await draw({ theatre, session });
  await expect.element(screen.getByText(movie.name)).toBeVisible();

  const card = screen.container.querySelector('[data-slot="card"]') as HTMLElement;
  const content = screen.container.querySelector('[data-slot="card-content"]') as HTMLElement;
  expect(card).toHaveAttribute("data-size", "sm");
  const box = getComputedStyle(card);
  expect([box.paddingTop, box.paddingBottom]).toEqual(["16px", "16px"]);
  const inner = getComputedStyle(content);
  expect([inner.paddingLeft, inner.paddingRight]).toEqual(["16px", "16px"]);
});

/*
 * ...and narrow enough not to read as an empty panel
 *
 * The content is about 350px of poster and text. Left to fill the 704px column the card
 * is mostly blank surface, which is what made it feel like a large element rather than a
 * summary. The cap is what stops that, and it also fixes the width so a long theatre name
 * wraps rather than resizing the card
 */
test("the card is capped and centred rather than filling the column", async () => {
  const screen = await draw({ theatre, session });
  await expect.element(screen.getByText(movie.name)).toBeVisible();

  const wrapper = screen.container.firstElementChild as HTMLElement;
  const card = screen.container.querySelector('[data-slot="card"]') as HTMLElement;
  const outer = wrapper.getBoundingClientRect();
  const box = card.getBoundingClientRect();

  expect(box.width).toBe(448);
  expect(box.width).toBeLessThan(outer.width);
  // Equal gutters either side, which is the difference between capped and merely narrow
  expect(Math.round(box.left - outer.left)).toBe(Math.round(outer.right - box.right));
});

/*
 * The card appears with a movie and a venue and grows two more lines when a showtime lands.
 * The poster is taller than the text column either way, so that growth must not move it
 */
test("picking a showtime does not resize the card", async () => {
  const before = await draw({ theatre, session: null });
  await expect.element(before.getByText(movie.name)).toBeVisible();
  const pending = (
    before.container.querySelector('[data-slot="card"]') as HTMLElement
  ).getBoundingClientRect().height;

  const after = await draw({ theatre, session });
  await expect.element(after.getByRole("link").first()).toBeVisible();
  const chosen = (
    after.container.querySelector('[data-slot="card"]') as HTMLElement
  ).getBoundingClientRect().height;

  expect(chosen).toBe(pending);
});
