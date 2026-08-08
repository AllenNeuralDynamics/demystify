# Project Intent

## Problem

MyST makes scientific manuscripts reproducible and publishable from Git, but Git does not provide the low-friction simultaneous editing expected by research teams. Moving prose through Google Docs or Word introduces lossy conversion, separates review from the publication source, and makes figures, citations, directives, and provenance harder to preserve.

## Goal

DeMystify provides a Google-Docs-like editing surface while keeping valid MyST Markdown and a GitHub repository as the durable source of truth.

The intended workflow is:

1. A repository owner installs the DeMystify GitHub App on selected repositories.
2. Collaborators authenticate with their existing GitHub identities.
3. DeMystify loads a manuscript file into a shared Yjs document.
4. Authors edit together with presence, comments, and immediate preview.
5. The first deliberate snapshot creates a working branch and draft pull request; later snapshots update that same review.
6. The repository's existing tests and MyST build remain the publication gate.

## Principles

- **GitHub remains canonical.** Live collaboration complements branches and pull requests; it does not replace them.
- **MyST remains source.** Directives, citations, equations, figures, and readable Markdown must survive editing without round-trip conversion.
- **Least privilege.** Repository access comes from a narrowly scoped GitHub App, never shared personal access tokens.
- **Repository rules still apply.** Generated assets, provenance, authorship, tests, and branch protection remain owned by each manuscript repository.
- **Attribution is explicit.** GitHub identity should drive presence and audit history, while scientific authorship remains governed by the manuscript project.

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

The repository contains a tested MVP with GitHub-gated WebSocket rooms and shared PostgreSQL persistence for Yjs state, room bindings, and sessions. Before broad deployment it needs repository-aware asset resolution, server-rendered previews using each repository's actual MyST configuration, horizontal WebSocket fan-out, and operational controls.