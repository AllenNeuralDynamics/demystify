# A shared language for reproducible manuscripts

**Ada Researcher¹, Lin Collaborator², and the Open Methods Group**

:::{admonition} Abstract
:class: abstract
Scientific writing is collaborative, but the tools for writing and the tools for publishing rarely share the same source of truth. We present a workflow where every edit remains valid MyST Markdown while collaborators write together in real time.
:::

## Introduction

A manuscript should be as inspectable as the analysis behind it. MyST gives research teams structured figures, equations, citations, and executable content without giving up readable source text.

This document is being edited through a shared Yjs document. Open the same URL in another window and type in either editor: both copies converge without locking the file.

:::{note}
The live preview is generated from the official JavaScript MyST parser. Directives remain directives in Git rather than being flattened into HTML.
:::

## A simple model

For collaborators $i = 1, \ldots, n$, we measure agreement after concurrent edits as

$$
C = 1 - \frac{d(s_1, s_2)}{\max(|s_1|, |s_2|)}
$$ (eq:convergence)

where $d$ is the edit distance between synchronized manuscript states. A conflict-free replicated data type drives $C$ to one after updates have propagated.

:::{figure} /sample-figure.svg
:name: fig-convergence
:alt: Convergence of three collaborator sessions over time

Independent editing sessions converge on the same manuscript state after each burst of changes.
:::

## Results

| Workflow | Simultaneous editing | Reviewable history | Structured publishing |
| --- | :---: | :---: | :---: |
| Shared document | Yes | Limited | No |
| Git alone | No | Yes | Yes |
| DeMystify | Yes | Yes | Yes |

## Discussion

The repository remains the durable record. Live updates are collected into deliberate snapshots, committed to a branch, and reviewed through a pull request.
