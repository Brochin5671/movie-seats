import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Movie, Session, Theatre } from "@/lib/cineplex/types";
import { ShowtimeCard } from "./ShowtimeCard";

/*
 * The card's four lines, the partial state it renders in before a showtime is picked,
 * and the two traps beside them: an empty img src, and a `<time>` element whose
 * accessible name axe cannot check
 */

const movie: Movie = {
  id: 37997,
  name: "Spider-Man: Brand New Day",
  runtimeInMinutes: 145,
  genres: ["Action"],
  releaseDate: "2026-07-31",
  posterUrl: "https://mediafiles.cineplex.com/poster.jpg",
  isNowPlaying: true,
  isComingSoon: false,
};

const theatre: Theatre = {
  id: 7249,
  name: "Galaxy Cinemas Barrie",
  city: "Barrie",
  province: "ON",
  latitude: 44.3,
  longitude: -79.7,
  distanceMeters: null,
};

const session: Session = {
  sessionId: 326227,
  auditorium: "Aud 12",
  start: "2026-08-02T18:45:00",
  experiences: ["3D", "D-BOX"],
  seatsRemaining: 245,
  isSoldOut: false,
};

describe("ShowtimeCard", () => {
  /*
   * Every line, in order. `toHaveTextContent` on each one separately would pass with the
   * venue and the time the other way round, and the order is what this case is about: the
   * theatre is picked before the showtime, so it reads above it
   */
  it("shows the title, the venue, the theatre-local time and the screening in order", () => {
    const { container } = render(
      <ShowtimeCard movie={movie} theatre={theatre} session={session} />,
    );
    expect([...container.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "Spider-Man: Brand New Day",
      "Galaxy Cinemas Barrie",
      // the wall clock as sent, never converted
      "Sun Aug 2 · 6:45 PM",
      "Aud 12 · 3D · D-BOX",
    ]);
    /*
     * ...and the auditorium is its own run inside that last line. Read off the slot rather
     * than by text: it is free text upstream, rendered verbatim rather than parsed
     */
    expect(container.querySelector('[data-slot="showtime-auditorium"]')).toHaveTextContent(
      "Aud 12",
    );
  });

  /*
   * Built from the two ids, not taken from the payload. Upstream's own `ticketingUrl`
   * points at whatever page Cineplex runs today; this one opens the seat picker for the
   * exact screening on screen
   */
  it("links to the ticketing preview for this theatre and screening", () => {
    render(<ShowtimeCard movie={movie} theatre={theatre} session={session} />);
    expect(screen.getByRole("link", { name: /book on cineplex/i })).toHaveAttribute(
      "href",
      "https://www.cineplex.com/ticketing/preview?theatreId=7249&showtimeId=326227",
    );
  });

  /*
   * A new tab is a context change, so it has to be in the accessible name and not only in
   * the icon: a screen reader announces the link before the tab opens (WCAG 3.2.5). The
   * `rel` is the other half, since `target="_blank"` without it hands the opened page a
   * `window.opener` reference back to this one
   */
  it("opens in a new tab, and says so in the name", () => {
    render(<ShowtimeCard movie={movie} theatre={theatre} session={session} />);
    const link = screen.getByRole("link");
    // The whole name, in order. Two loose regexes would pass with the warning read out
    // before the label, which is not what a reader hears from a well-formed link
    expect(link).toHaveAccessibleName("Book on Cineplex (opens in a new tab)");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  /*
   * The state between picking a movie and picking a showtime. The poster is the
   * confirmation that the right film was chosen, so it renders early; the detail lines
   * hold a placeholder rather than collapsing, so the card does not jump when the
   * showtime lands
   */
  describe("before a showtime is chosen", () => {
    /*
     * The venue is already known here, so it renders: it is what says the theatre select has
     * landed while the reader is still picking a time. Everything below it waits, because a
     * placeholder would be text the reader has to read and discard
     */
    it("shows the poster, the title and the venue, and nothing below them", () => {
      const { container } = render(<ShowtimeCard movie={movie} theatre={theatre} session={null} />);
      expect(container.querySelector("img")).toHaveAttribute("src", movie.posterUrl);
      expect([...container.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
        "Spider-Man: Brand New Day",
        "Galaxy Cinemas Barrie",
      ]);
    });

    // ...and with neither picked the title still stands alone
    it("shows the title alone when there is no theatre either", () => {
      const { container } = render(<ShowtimeCard movie={movie} theatre={null} session={null} />);
      expect([...container.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
        "Spider-Man: Brand New Day",
      ]);
    });

    // Nothing to book yet, and a link to a screening that has not been chosen would go
    // somewhere wrong rather than nowhere
    it("offers no booking link", () => {
      render(<ShowtimeCard movie={movie} theatre={theatre} session={null} />);
      // Anchored: a component returning null would satisfy the absence on its own
      expect(screen.getByText(movie.name)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    // A session with no theatre: everything the session alone can fill renders, and the
    // venue line closes up rather than leaving a hole where it would have been
    it("survives a session with no theatre", () => {
      const { container } = render(<ShowtimeCard movie={movie} theatre={null} session={session} />);
      expect([...container.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
        "Spider-Man: Brand New Day",
        "Sun Aug 2 · 6:45 PM",
        "Aud 12 · 3D · D-BOX",
      ]);
      // ...and there is nowhere to book, since the link needs the theatre id
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  /*
   * The format a screening is presented in, which upstream splits across an experience
   * group per format and `toSessions` merges back onto one session
   */
  describe("the formats line", () => {
    const formatsOf = (container: HTMLElement) =>
      container.querySelector('[data-slot="showtime-formats"]')?.textContent;

    it("lists every format the screening carries", () => {
      const { container } = render(
        <ShowtimeCard movie={movie} theatre={theatre} session={session} />,
      );
      // The separator lives inside the slot, so the auditorium's own run stays clean
      expect(formatsOf(container)).toBe("· 3D · D-BOX");
    });

    /*
     * An ordinary 2D showing sends no experience group at all. The slot is never absent,
     * because the auditorium ahead of it would then end on a dangling separator
     */
    it("falls back to Regular when the screening carries none", () => {
      const { container } = render(
        <ShowtimeCard movie={movie} theatre={theatre} session={{ ...session, experiences: [] }} />,
      );
      expect(screen.getByText("Galaxy Cinemas Barrie")).toBeInTheDocument();
      expect(formatsOf(container)).toBe("· Regular");
    });

    /*
     * `experienceTypes` reaches the projection unvalidated, so an upstream blank is a real
     * shape rather than a hypothetical. A bare length check would pass it straight through
     * and leave the line ending on its separator
     */
    it("treats a blank experience as none at all", () => {
      const { container } = render(
        <ShowtimeCard
          movie={movie}
          theatre={theatre}
          session={{ ...session, experiences: ["  "] }}
        />,
      );
      expect(formatsOf(container)).toBe("· Regular");
    });

    it("drops a blank from among real formats rather than rendering a gap", () => {
      const { container } = render(
        <ShowtimeCard
          movie={movie}
          theatre={theatre}
          session={{ ...session, experiences: ["3D", "", "IMAX"] }}
        />,
      );
      expect(formatsOf(container)).toBe("· 3D · IMAX");
    });
  });

  /*
   * `<img src="">` re-requests the current document in some browsers, so a missing
   * poster has to render something else entirely rather than an empty src
   */
  it("renders no image at all when there is no poster", () => {
    const { container } = render(
      <ShowtimeCard movie={{ ...movie, posterUrl: null }} theatre={theatre} session={session} />,
    );
    // Anchored, as above: no image is trivially true of a card that did not render
    expect(screen.getByText(movie.name)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  /*
   * `<time>` has no ARIA role, so naming it is prohibited and readers commonly drop the
   * label. The build tier fails on it, and the cheapest way to never trip that is to
   * not reach for the element
   */
  it("uses no time element", () => {
    const { container } = render(
      <ShowtimeCard movie={movie} theatre={theatre} session={session} />,
    );
    // The time has to be on screen for its element to be the thing under test
    expect(screen.getByText(/6:45 PM/)).toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
  });

  it("leaves the poster unnamed, since the title follows it", () => {
    const { container } = render(
      <ShowtimeCard movie={movie} theatre={theatre} session={session} />,
    );
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});
