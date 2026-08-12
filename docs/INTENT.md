# Project Intent

## Problem

MyST makes scientific manuscripts reproducible and publishable from Git, but Git does not provide the low-friction simultaneous editing expected by research teams. Moving prose through Google Docs or Word introduces lossy conversion, separates review from the publication source, and makes figures, citations, directives, and provenance harder to preserve.

## Goal

DeMystify provides a Google-Docs-like editing surface while keeping valid MyST Markdown and a GitHub repository as the durable source of truth.

The intended workflow is:

1. A repository owner installs the DeMystify GitHub App on selected repositories.
2. Maintainers authenticate with GitHub and pass a repository write check. Invited reviewers use a revocable Suggestion link to comment and propose attributed Visual prose edits for maintainer acceptance; they may also authenticate for verified attribution without gaining source or publish access. Viewers use an independent read-only link with the same expiration options.
3. DeMystify loads a manuscript file into a shared Yjs document.
4. Maintainers edit together while invited reviewers propose and discuss anchored changes; everyone shares presence, comments, and a fast, debounced browser preview.
5. The first deliberate snapshot creates a working branch and draft pull request; later snapshots update that same review.
6. The repository's existing tests and MyST build remain the publication gate.

## Principles

- **GitHub remains canonical.** Live collaboration complements branches and pull requests; it does not replace them.
- **MyST remains source.** Directives, citations, equations, figures, and readable Markdown must survive editing without round-trip conversion.
- **MyST configuration remains canonical.** Project and publication controls read and write standard page frontmatter or `project` fields in `myst.yml`. Authors use MyST `authors` and `affiliations`, including ORCID and CRediT `roles`; DeMystify does not maintain a parallel authorship schema.
- **Least privilege.** Repository access comes from a narrowly scoped GitHub App, never shared personal access tokens.
- **Repository rules still apply.** Generated assets, provenance, authorship, tests, and branch protection remain owned by each manuscript repository.
- **Attribution is explicit.** When provided, GitHub identity drives verified presence and comment attribution; invited users may remain anonymous to GitHub, while scientific authorship remains governed by the manuscript project.
- **Review is deliberate.** Invited proposals do not mutate canonical MyST until a maintainer accepts the exact anchored source change. Rejections, conflicts, discussions, and decisions remain review records rather than disappearing from history.

## Intended Users

- Scientific teams maintaining MyST or Jupyter Book publications
- Contributors who need a browser editor rather than a local Git workflow
- Maintainers who want collaborative drafting to end in reviewable pull requests

## Non-goals

- Replacing GitHub, MyST, or repository CI
- Treating every keystroke as a Git commit
- Editing generated figures or analysis outputs without their owning source
- Inferring scientific authorship from Git commit history
- Becoming a general-purpose word processor

## Current Status

The repository contains a tested MVP with GitHub-gated WebSocket rooms and shared PostgreSQL persistence for Yjs state, room bindings, and sessions. It includes a source-preserving editor for canonical MyST metadata and authorship, server-enforced attributed Visual suggestions with threaded discussion and maintainer decisions, and multi-file project collaboration discovered from MyST exports, TOCs, includes, and AuthorshipExtractor YAML dependencies. The browser provides a safe data-backed static authorship roster while leaving remote plugin execution and authoritative publication builds to repository GitHub Actions. Before broad deployment it still needs build-status/artifact integration, source-level and secondary-file suggestions, horizontal WebSocket fan-out, and operational controls.