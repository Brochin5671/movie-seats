# Changelog

All notable changes to this project will be documented in this file.

Releases are managed by [semantic-release](https://github.com/semantic-release/semantic-release) using the [conventionalcommits](https://www.conventionalcommits.org) preset; new entries are auto-generated from commit messages.

## [1.0.1](https://github.com/Brochin5671/movie-seats/compare/v1.0.0...v1.0.1) (2026-10-22)

### Fixes

* **deps:** patch the HIGH and CRITICAL dependency advisories ([ba1ba21](https://github.com/Brochin5671/movie-seats/commit/ba1ba21516732396e96aef65add0dc8bf537c34e))
* **deps:** require Node 24.22.1, the October 2026 security release ([af3a8b3](https://github.com/Brochin5671/movie-seats/commit/af3a8b3ebf4c50017bcf3aaefb126b49d2cb4fb7))

### Documentation

* license the source and drop the key-acquisition instructions ([0d8f776](https://github.com/Brochin5671/movie-seats/commit/0d8f776a28571762fb7a090ce6fd1986d1a9be9c))

## [1.0.0](https://github.com/Brochin5671/movie-seats/compare/v0.2.0...v1.0.0) (2026-08-04)

### ⚠ BREAKING CHANGES

* **seat-finder:** `Theatre.latitude` and `Theatre.longitude` in the `/api/theatres`
response are now `number | null`. They were always a number, with an absent location
coerced to 0, which is a real coordinate off West Africa rather than a missing one.
A client reading them must handle null.
* **seat-map:** `Seat.column` in the `/api/seats` response is now measured across
the whole house, with each area's own offset already applied. It used to be copied
from upstream unchanged, where it is measured against the area the seat sits in, so
every D-BOX seat reported a column it did not occupy. A client that drew the old
value against `totalColumns` was drawing the wrong grid.

### Features

* **home:** add the compact masthead ([fb4e33a](https://github.com/Brochin5671/movie-seats/commit/fb4e33a4a9f312720829d1036fa491d6e67e6ac5))
* **seat-finder:** order the theatres by how far away they are ([cb893c3](https://github.com/Brochin5671/movie-seats/commit/cb893c3665317012808e369190afd11fb9323fc7))
* **seating:** prefer D-BOX seats when recommending ([cf19c13](https://github.com/Brochin5671/movie-seats/commit/cf19c1303806a6bdb41dd221738719e66211f433))
* **showtime-card:** lead with the venue and tighten the card ([a5f64b5](https://github.com/Brochin5671/movie-seats/commit/a5f64b5b24323e6088a4d176ad98247db7e750e3))

### Fixes

* **seat-map:** keep every row on the same grid tracks ([bf3fcae](https://github.com/Brochin5671/movie-seats/commit/bf3fcae06353290cb624fce37259ec6723480db4))
* **seat-map:** key rows by position, not by area-local number ([4f27e96](https://github.com/Brochin5671/movie-seats/commit/4f27e96fb0ee14d33cfc3f730be3dbd595a57579))
* **seat-map:** place a D-BOX block where the layout puts it ([d418c92](https://github.com/Brochin5671/movie-seats/commit/d418c92d7bc22d34b345354b6e6ed151897fc9c7))
* **seating:** centre the recommendation on the row's own columns ([14d3ebb](https://github.com/Brochin5671/movie-seats/commit/14d3ebb923ce0112b8c0138b95097ec1f4b0fc03))

### Documentation

* bring the reference files in step with this round ([783d4af](https://github.com/Brochin5671/movie-seats/commit/783d4af546d65c7c67f8defb418b1303eb4bfbc7))
* **readme:** explain how the site works and how to use it ([45272cb](https://github.com/Brochin5671/movie-seats/commit/45272cb30344d4fbd7ef6b12ea9da74a4520b665))

## [0.2.0](https://github.com/Brochin5671/movie-seats/compare/v0.1.0...v0.2.0) (2026-08-04)

### Features

* **capacity-meter:** move the refresh control beside the label and enlarge it ([e15f4b8](https://github.com/Brochin5671/movie-seats/commit/e15f4b849f6bd5a7b51b8fa75dff811bb33bba76))
* **combobox:** let the disclosure trigger take a different icon ([094e9b4](https://github.com/Brochin5671/movie-seats/commit/094e9b4d45a5de7c09aaacaaa4c2b966c1e94ea8))
* **seat-finder:** say pick rather than choose in the select placeholders ([d3b2320](https://github.com/Brochin5671/movie-seats/commit/d3b2320110e109ade4a4f0afb039014162bdd7a4))
* **seat-finder:** show a search glyph on the three selects ([d387132](https://github.com/Brochin5671/movie-seats/commit/d387132f111d482a1f75ac3f411f8a30a4fb23b7))
* **seo:** title case the tagline ([67af0d9](https://github.com/Brochin5671/movie-seats/commit/67af0d943748eb0cd869dd7cd63271b251bd6e42))
* **showtime-card:** group the auditorium with the screening formats ([4a95b81](https://github.com/Brochin5671/movie-seats/commit/4a95b81488c555a0c70e2cff5a5878e1a30292cf))

### Fixes

* **seat-legend:** enlarge the explainer trigger past the target-size floor ([422392d](https://github.com/Brochin5671/movie-seats/commit/422392d0f2f3ac0e3c5848367c7325f8d9f581df))
* **seat-map:** paint the scroller's scrollbar from the cinema palette ([fb5362e](https://github.com/Brochin5671/movie-seats/commit/fb5362edb37608f27ba0196b3f40ea376e93f277))

### Documentation

* **readme:** describe AGENTS.md as the file agents read ([79f8dd2](https://github.com/Brochin5671/movie-seats/commit/79f8dd260b816b7f2cf831a8bed6033cdc09e650))

### Changed

* **meter:** drop the label and value subcomponents ([1bff8ff](https://github.com/Brochin5671/movie-seats/commit/1bff8ffbc92c62384ac18778ae524f81ee5d4260))

## [0.1.0](https://github.com/Brochin5671/movie-seats/compare/v0.0.0...v0.1.0) (2026-08-03)

### Features

* birth of the app ([1b933f1](https://github.com/Brochin5671/movie-seats/commit/1b933f1b48a7bee447e9dc5b61597c162a6046e1))
