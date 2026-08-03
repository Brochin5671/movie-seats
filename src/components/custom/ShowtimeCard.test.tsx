import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Movie, Session, Theatre } from "@/lib/cineplex/types";
import { ShowtimeCard } from "./ShowtimeCard";

/*
 * The card's three lines, the partial state it renders in before a showtime is picked,
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
  it("shows the title, the theatre-local time and the auditorium", () => {
    render(<ShowtimeCard movie={movie} theatre={theatre} session={session} />);
    expect(screen.getByText("Spider-Man: Brand New Day")).toBeInTheDocument();
    // the wall clock as sent, never converted
    expect(screen.getByText(/Sun Aug 2/)).toHaveTextContent("6:45 PM");
    // free text upstream, rendered verbatim rather than parsed for a number
    expect(screen.getByText(/Galaxy Cinemas Barrie/)).toHaveTextContent("Aud 12");
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
    it("shows the poster and the title, and nothing where the details will go", () => {
      const { container } = render(<ShowtimeCard movie={movie} theatre={theatre} session={null} />);
      expect(container.querySelector("img")).toHaveAttribute("src", movie.posterUrl);
      expect(screen.getByText("Spider-Man: Brand New Day")).toBeInTheDocument();
      // The title is the only line. A placeholder here would be text the reader has to
      // read and discard before the real value replaces it
      expect(container.querySelectorAll("p")).toHaveLength(1);
    });

    // Nothing to book yet, and a link to a screening that has not been chosen would go
    // somewhere wrong rather than nowhere
    it("offers no booking link", () => {
      render(<ShowtimeCard movie={movie} theatre={theatre} session={null} />);
      // Anchored: a component returning null would satisfy the absence on its own
      expect(screen.getByText(movie.name)).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    /*
     * A theatre-shaped hole with a real session, not both null: the `session` guard
     * short-circuits first, so `theatre={null} session={null}` never evaluates the theatre
     * check at all and deleting it would leave the case green
     */
    it("survives a session with no theatre", () => {
      const { container } = render(<ShowtimeCard movie={movie} theatre={null} session={session} />);
      // the time still renders, since it needs only the session...
      expect(screen.getByText(/6:45 PM/)).toBeInTheDocument();
      // ...while the line that needs both is simply absent, and there is nowhere to book
      expect(screen.queryByText(/Galaxy Cinemas Barrie/)).not.toBeInTheDocument();
      // title, time, and the formats line, which needs only the session as well
      expect(container.querySelectorAll("p")).toHaveLength(3);
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
      expect(formatsOf(container)).toBe("3D · D-BOX");
    });

    // No line at all rather than an empty one, which would open a gap under the subtitle
    it("renders nothing when the screening carries none", () => {
      const { container } = render(
        <ShowtimeCard movie={movie} theatre={theatre} session={{ ...session, experiences: [] }} />,
      );
      expect(screen.getByText(/Galaxy Cinemas Barrie/)).toBeInTheDocument();
      expect(container.querySelector('[data-slot="showtime-formats"]')).toBeNull();
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
