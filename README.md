# Freese Frame

**The Elementary Forest Sampling App**  
**The Frank Freese Tribute App**

Freese Frame is a desktop-first browser application for designing, mapping, and analyzing forest samples using practical methods and guidance derived from Frank Freese's *Elementary Forest Sampling*, USDA Forest Service Agriculture Handbook No. 232.

## Current working version

The first functional build includes:

- desktop-first browser UI using the approved forest-green / warm-paper / sage / brown / gold palette;
- sample-size planning from expected mean, CV, desired precision, confidence level, and finite population size;
- simple design guidance for random, stratified, and two-stage situations;
- interactive aerial/street map;
- polygon drawing and GeoJSON boundary import;
- automatic acreage calculation;
- random point generation inside the polygon;
- systematic grid generation with randomized offset and selectable bearing;
- edge buffering;
- circular plot visualization for common plot sizes;
- KML, KMZ, and CSV sample-location export;
- basic simple-random-sample analysis with finite-population correction and Student's t confidence intervals;
- save/open project JSON;
- integrated Freese Guidance and publication credit;
- SEO/GEO-oriented metadata and structured data.

## Product principle

The user should start with the forestry problem, not the statistical method.

The core workflow is:

**Design → Map → Analyze**

## Source and attribution

Primary source:

> Freese, Frank. 1962. *Elementary Forest Sampling*. Agriculture Handbook No. 232. U.S. Department of Agriculture, Forest Service, Southern Forest Experiment Station.

Freese Frame uses three labels:

- **Freese Method** — direct or essentially direct implementation of a method in the handbook.
- **Freese Guidance** — advice, cautions, assumptions, or explanations derived from the handbook.
- **Modern Implementation** — browser UI, GIS capabilities, numerical automation, or extensions not presented by Freese.

The application is an independent implementation and does not imply USDA Forest Service endorsement.

## Run locally

This is a static site. Serve the repository directory with any local HTTP server, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deployment

A GitHub Pages workflow is included in `.github/workflows/pages.yml`.

Repository: https://github.com/loggingchance/freese
