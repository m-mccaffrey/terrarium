# Terrarium Planner

A browser tool for planning a gecko or lizard enclosure in 3D. Pick the animal, size the tank, choose a substrate, place decor, and the planner checks the layout against that animal's care requirements and builds a shopping list.

**Live site:** https://m-mccaffrey.github.io/terrarium/

## What it does

- **Animals:** leopard gecko, crested gecko, gargoyle gecko, giant day gecko, African fat-tailed gecko, bearded dragon and blue-tongued skink. Each comes with care requirements (minimum tank, basking and cool-side temperatures, night low, humidity, UVB, hides, climate) and a starter layout.
- **Tank:** common presets (20 gallon long up to 5×2×2) or a custom size, glass or PVC, a 3D background wall, room temperature and misting schedule. Imperial or metric units.
- **Ground:** eight substrates, base depth, a bioactive drainage layer shown in cross-section, and sculpting tools for hills and dips.
- **Decor:** about 35 items, including hides, wood, rocks, live plants, dishes, basking lamps, UVB, heat mats and thermometers. Drag them around the tank; lamps sit on the lid and ledges stick to the walls. Selecting an item shows its size.
- **Size reference:** a life-size model of the adult animal that you can drag around to check fit.
- **Heat map:** shows the warm-to-cool gradient from the basking lamps. Hover to read a surface temperature.
- **Habitat check:** each requirement with your value, the target and a pass/review/fix status.
- **Shopping list:** substrate quantities worked out from the floor area and depth, rough price ranges, extras like a thermostat, and print or copy.
- **Saving:** designs are kept in the browser. You can also export and import them as JSON or download a PNG.

Temperatures and humidity are planning estimates. They come from bulb wattage, distance to each surface, substrate, plants, ventilation and misting. Always confirm them with real thermometers once the enclosure is running.

## Running locally

It's a static site with no build step. Serve the folder with any static server, for example:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Three.js r170 is vendored in `vendor/three/`.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | Page shell and styles |
| `js/main.js` | Panels, toolbars, modals, keyboard shortcuts |
| `js/viewer.js` | 3D scene, picking/dragging, sculpting, heat map, stats |
| `js/data.js` | Species requirements, tank presets, substrates, decor catalog, starter layouts |
| `js/climate.js` | Temperature/humidity model and the habitat check |
| `js/models.js`, `js/animal.js`, `js/tank.js`, `js/terrain.js`, `js/textures.js` | Procedural 3D models and textures |
| `js/store.js` | State, undo/redo, saving |

## Deploying

Pushes to `main` deploy to GitHub Pages through `.github/workflows/pages.yml`.
