# Developing Schedules

`README.md` is the text the Marketplace shows under **About** on the listing of Schedules, so it is written for the people who install it. This file is for the people who work on it.

Schedules is the one place every recurring task is authored and listed: any
app's agent asks it for a timed run, and it starts the conversation when the
time comes. It is an ordinary Hearthscale app. Nothing in the platform knows
its name; it installs from the Marketplace like any other app.

## Working on it

With a Hearthscale platform running on this machine:

```sh
hearthscale dev .
```

links this folder into the running platform, picks up every change, and
asks once in the window before any code runs.

## The view

Schedules shows one view, `schedules`, which fills its tab when the rail
opens it: the list, and in its place one schedule or the form of a new
one. Its source is React under `ui/src`, drawn with the `hs-*` classes and
`ri-*` icons of the kit that Hearthscale loads into every view. Its build
writes `views/schedules.js`, the one file the package carries for it, so
the file is committed with every change to the source:

```sh
cd ui
pnpm install
pnpm build
```

The view reaches its backend only through the tools `app.json` declares
with `"visibility": ["app"]`, which no agent sees, and the platform only
through the extensions `uses` names: `events` for the backend's `changed`
event, and `surfaces.open` to open a run's conversation. It keeps the
schedule open over the list, the filter and the search with
`hearthscale/ui/set-widget-state`, and starts from `hearthscale/widgetState`
when the host loads it again.

`ui/pnpm-workspace.yaml` keeps the build its own project: without it, pnpm
joins any workspace in a folder above.

## Releasing

Install the Hearthscale registry's GitHub App on this repository once. Then
every release whose tag equals `version` in `app.json` is picked up by the
Marketplace.

```sh
hearthscale pack .
```

builds the package to attach to the release.

## Licence

MIT. See `LICENSE`.
