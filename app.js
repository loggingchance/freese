(() => {
  "use strict";

  const state = {
    boundary: null,
    sample: null,
    sampleDesign: "random",
    plannedN: 30,
    mapInitialized: false
  };

  const titles = {
    home: "Forest sampling, from question to field layout.",
    plan: "Plan a defensible sample.",
    map: "Turn the sampling design into field locations.",
    analyze: "Bring field observations back into the analysis.",
    compare: "Compare cost and precision before committing field time.",
    guidance: "Practical guidance from Frank Freese's handbook.",
    about: "Credit the source clearly and throughout."
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString(undefined, {maximumFractionDigits:d}) : "—";

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.querySelectorAll(".nav-item").forEach(v => v.classList.toggle("active", v.dataset.view === name));
    const target = $("view-" + name);
    if (target) target.classList.add("active");
    $("view-title").textContent = titles[name] || "";
    if (name === "map") {
      initMap();
      setTimeout(() => map.invalidateSize(), 60);
    }
    history.replaceState(null, "", "#" + name);
    window.scrollTo({top:0, behavior:"smooth"});
  }

  document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => showView(el.dataset.view)));
  if (location.hash && $("view-" + location.hash.slice(1))) showView(location.hash.slice(1));

  function tCritical(confidence, df) {
    const alpha = 1 - confidence;
    if (window.jStat && df > 0) return jStat.studentt.inv(1 - alpha / 2, df);
    return confidence >= .99 ? 2.576 : confidence >= .95 ? 1.96 : 1.645;
  }

  function estimateSampleSize(mean, cvPct, relPrecisionPct, confidence, N) {
    const sd = mean * cvPct / 100;
    const E = Math.abs(mean * relPrecisionPct / 100);
    if (!(sd > 0) || !(E > 0)) return null;
    const z = confidence >= .99 ? 2.576 : confidence >= .95 ? 1.96 : 1.645;
    let n = Math.ceil((z*z*sd*sd)/(E*E));
    if (N > 0) n = Math.ceil(1 / ((E*E)/(z*z*sd*sd) + 1/N));
    n = Math.max(2, n);

    for (let i = 0; i < 12; i++) {
      const t = tCritical(confidence, Math.max(1, n-1));
      const next = N > 0
        ? Math.ceil(1 / ((E*E)/(t*t*sd*sd) + 1/N))
        : Math.ceil((t*t*sd*sd)/(E*E));
      if (next === n) break;
      n = Math.max(2, next);
    }
    if (N > 0) n = Math.min(n, N);
    return {n, sd, E};
  }

  $("calculate-plan").addEventListener("click", () => {
    const mean = +$("expected-mean").value;
    const cv = +$("expected-cv").value;
    const precision = +$("desired-precision").value;
    const confidence = +$("confidence-level").value;
    const N = +$("population-size").value || 0;
    const result = estimateSampleSize(mean, cv, precision, confidence, N);
    if (!result) return toast("Enter a positive mean, CV, and desired precision.");

    const stratified = $("has-strata").value === "yes";
    const travel = $("travel-expensive").value === "yes";
    let design = "Simple random";
    let rationale = "A simple random design is a sound starting point when the population is not being divided into known strata.";
    if (stratified) {
      design = "Stratified random";
      rationale = "You indicated useful strata are available. Stratification can improve precision when units within strata are more alike than units across the whole population.";
    } else if (travel) {
      design = "Consider two-stage sampling";
      rationale = "You indicated that travel or location cost is high relative to measurement cost. Freese identifies this as a situation where taking multiple observations at selected primary locations may reduce cost.";
    }

    state.plannedN = result.n;
    $("map-sample-count").value = result.n;
    $("recommended-n").textContent = result.n.toLocaleString();
    $("expected-sd").textContent = fmt(result.sd);
    $("absolute-precision").textContent = "±" + fmt(result.E);
    $("result-confidence").textContent = Math.round(confidence*100) + "%";
    $("suggested-design").textContent = design;
    $("plan-summary").textContent = rationale;
    $("plan-result").classList.remove("hidden");
    toast("Sample plan calculated.");
  });

  $("analyze-values").addEventListener("click", () => {
    const values = $("sample-values").value.split(/[\s,;]+/).map(Number).filter(Number.isFinite);
    if (values.length < 2) return toast("Enter at least two numeric observations.");
    const n = values.length;
    const mean = values.reduce((a,b)=>a+b,0) / n;
    const variance = values.reduce((s,x)=>s+(x-mean)**2,0)/(n-1);
    const sd = Math.sqrt(variance);
    const cv = mean !== 0 ? sd / Math.abs(mean) * 100 : NaN;
    const N = +$("analysis-population").value || 0;
    const fpc = N > 0 && n <= N ? Math.sqrt((N-n)/(N-1)) : 1;
    const se = sd / Math.sqrt(n) * fpc;
    const confidence = +$("analysis-confidence").value;
    const t = tCritical(confidence, n-1);
    const lo = mean - t*se, hi = mean + t*se;
    const expand = +$("analysis-expansion").value || 1;

    $("stat-n").textContent = n;
    $("stat-mean").textContent = fmt(mean,3);
    $("stat-sd").textContent = fmt(sd,3);
    $("stat-cv").textContent = fmt(cv,1) + "%";
    $("stat-se").textContent = fmt(se,3);
    $("stat-ci").textContent = fmt(lo,2) + " – " + fmt(hi,2);
    $("stat-expanded").textContent = fmt(mean*expand,2);
    $("stat-expanded-se").textContent = fmt(se*expand,2);
    $("analysis-results").classList.remove("hidden");
  });

  let map, drawnItems, sampleLayer, plotBoundaryLayer;

  function initMap() {
    if (state.mapInitialized) return;
    state.mapInitialized = true;

    map = L.map("map", {zoomControl:true}).setView([44.4, -72.7], 8);

    const streets = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    });

    const imagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri and imagery providers"
    }).addTo(map);

    L.control.layers({"Aerial imagery": imagery, "Street map": streets}, null, {position:"topright"}).addTo(map);

    drawnItems = new L.FeatureGroup().addTo(map);
    sampleLayer = new L.FeatureGroup().addTo(map);
    plotBoundaryLayer = new L.FeatureGroup().addTo(map);

    const drawControl = new L.Control.Draw({
      position:"topleft",
      edit:{featureGroup:drawnItems, remove:true},
      draw:{polyline:false, rectangle:true, circle:false, circlemarker:false, marker:false, polygon:{allowIntersection:false, showArea:true}}
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, e => {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
      state.boundary = e.layer.toGeoJSON();
      updateArea();
      sampleLayer.clearLayers();
      plotBoundaryLayer.clearLayers();
      state.sample = null;
    });

    map.on(L.Draw.Event.EDITED, () => {
      const layers = drawnItems.getLayers();
      if (layers.length) state.boundary = layers[0].toGeoJSON();
      updateArea();
    });

    map.on(L.Draw.Event.DELETED, () => {
      state.boundary = null;
      state.sample = null;
      sampleLayer.clearLayers();
      plotBoundaryLayer.clearLayers();
      updateArea();
    });
  }

  function updateArea() {
    if (!state.boundary) {
      $("mapped-acres").textContent = "0 acres";
      return;
    }
    const acres = turf.area(state.boundary) / 4046.8564224;
    $("mapped-acres").textContent = fmt(acres,2) + " acres";
  }

  function workingPolygon() {
    if (!state.boundary) return null;
    const bufferFt = +$("edge-buffer").value || 0;
    if (bufferFt <= 0) return state.boundary;
    try {
      const buffered = turf.buffer(state.boundary, -(bufferFt * 0.3048), {units:"meters"});
      return buffered && buffered.geometry ? buffered : state.boundary;
    } catch (_) {
      return state.boundary;
    }
  }

  function randomPointsInPolygon(poly, count) {
    const bbox = turf.bbox(poly);
    const features = [];
    let tries = 0;
    const maxTries = Math.max(5000, count*1000);
    while (features.length < count && tries < maxTries) {
      tries++;
      const lng = bbox[0] + Math.random() * (bbox[2]-bbox[0]);
      const lat = bbox[1] + Math.random() * (bbox[3]-bbox[1]);
      const p = turf.point([lng,lat]);
      if (turf.booleanPointInPolygon(p, poly)) features.push(p);
    }
    return turf.featureCollection(features);
  }

  function systematicPoints(poly, target, bearing) {
    const areaM2 = turf.area(poly);
    let spacingKm = Math.sqrt(areaM2 / Math.max(1,target)) / 1000;
    const center = turf.centroid(poly);
    let best = turf.featureCollection([]);

    for (let attempt=0; attempt<12; attempt++) {
      const buffered = turf.buffer(poly, spacingKm*2, {units:"kilometers"});
      const bbox = turf.bbox(buffered);
      let grid = turf.pointGrid(bbox, spacingKm, {units:"kilometers"});
      const shiftDistance = Math.random() * spacingKm * .7;
      const shiftBearing = Math.random() * 360;
      grid = turf.featureCollection(grid.features.map(f => turf.transformTranslate(f, shiftDistance, shiftBearing, {units:"kilometers"})));
      if (bearing) grid = turf.transformRotate(grid, bearing, {pivot:center.geometry.coordinates});
      const inside = grid.features.filter(p => turf.booleanPointInPolygon(p, poly));
      best = turf.featureCollection(inside);
      const ratio = inside.length / Math.max(1,target);
      if (Math.abs(inside.length-target) <= Math.max(1, target*.12)) break;
      spacingKm *= Math.sqrt(Math.max(.15, ratio));
    }

    if (best.features.length > target) {
      const step = best.features.length / target;
      const selected = [];
      for (let i=0; i<target; i++) selected.push(best.features[Math.floor(i*step)]);
      best = turf.featureCollection(selected);
    }
    return best;
  }

  function circleRadiusMeters(acres) {
    if (!(acres > 0)) return 0;
    return Math.sqrt(acres * 4046.8564224 / Math.PI);
  }

  function renderSample(fc, design) {
    sampleLayer.clearLayers();
    plotBoundaryLayer.clearLayers();
    const plotAcres = +$("plot-size").value || 0;
    const radius = circleRadiusMeters(plotAcres);
    const color = design === "random" ? "#d98b24" : "#2767b2";

    fc.features.forEach((f, i) => {
      f.properties = {...f.properties, plot_id:i+1, design};
      const [lng,lat] = f.geometry.coordinates;
      const marker = L.circleMarker([lat,lng], {
        radius:7, color:"#ffffff", weight:2, fillColor:color, fillOpacity:1
      }).bindTooltip(String(i+1), {permanent:true, direction:"center", className:"plot-label", offset:[0,0]});
      marker.bindPopup("<strong>Plot " + (i+1) + "</strong><br>" + lat.toFixed(6) + ", " + lng.toFixed(6) + "<br>Design: " + design);
      sampleLayer.addLayer(marker);
      if (radius > 0) {
        plotBoundaryLayer.addLayer(L.circle([lat,lng], {radius, color, weight:1, fillOpacity:.04, opacity:.75, interactive:false}));
      }
    });
    $("generated-count").textContent = fc.features.length;
  }

  $("generate-sample").addEventListener("click", () => {
    initMap();
    const poly = workingPolygon();
    if (!poly) return toast("Draw or import a tract boundary first.");
    const count = Math.max(1, Math.round(+$("map-sample-count").value || 0));
    const design = $("map-design").value;
    let fc;
    if (design === "random") fc = randomPointsInPolygon(poly, count);
    else fc = systematicPoints(poly, count, +$("grid-bearing").value || 0);
    state.sample = fc;
    state.sampleDesign = design;
    renderSample(fc, design);
    toast("Generated " + fc.features.length + " sample locations.");
  });

  $("clear-sample").addEventListener("click", () => {
    state.sample = null;
    sampleLayer && sampleLayer.clearLayers();
    plotBoundaryLayer && plotBoundaryLayer.clearLayers();
    $("generated-count").textContent = "0";
  });

  $("geojson-upload").addEventListener("change", async (e) => {
    initMap();
    const file = e.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      let feature = json.type === "FeatureCollection" ? json.features.find(f => /Polygon/.test(f.geometry?.type)) : json;
      if (!feature || !/Polygon/.test(feature.geometry?.type)) throw new Error("No polygon");
      drawnItems.clearLayers();
      const layer = L.geoJSON(feature).getLayers()[0];
      drawnItems.addLayer(layer);
      state.boundary = feature;
      updateArea();
      map.fitBounds(layer.getBounds(), {padding:[20,20]});
      toast("Boundary imported.");
    } catch (err) {
      toast("Could not import a polygon from that GeoJSON file.");
    } finally {
      e.target.value = "";
    }
  });

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]));
  }

  function toKml() {
    if (!state.boundary) throw new Error("No boundary");
    const placemarks = [];
    const ring = state.boundary.geometry.type === "Polygon"
      ? state.boundary.geometry.coordinates[0]
      : state.boundary.geometry.coordinates[0][0];
    placemarks.push("<Placemark><name>Tract Boundary</name><Style><LineStyle><color>ff2f4523</color><width>3</width></LineStyle><PolyStyle><color>332f4523</color></PolyStyle></Style><Polygon><outerBoundaryIs><LinearRing><coordinates>" +
      ring.map(c => c[0] + "," + c[1] + ",0").join(" ") +
      "</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>");

    if (state.sample) {
      state.sample.features.forEach((f,i) => {
        const [lng,lat] = f.geometry.coordinates;
        placemarks.push("<Placemark><name>Plot " + (i+1) + "</name><description>" + escapeXml("Design: " + state.sampleDesign) + "</description><Point><coordinates>" + lng + "," + lat + ",0</coordinates></Point></Placemark>");
      });
    }

    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Freese Frame Sample</name>' +
      placemarks.join("") + "</Document></kml>";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  $("export-kml").addEventListener("click", () => {
    try { downloadBlob(new Blob([toKml()], {type:"application/vnd.google-earth.kml+xml"}), "freese-frame-sample.kml"); }
    catch (_) { toast("Draw or import a tract boundary first."); }
  });

  $("export-kmz").addEventListener("click", async () => {
    try {
      const zip = new JSZip();
      zip.file("doc.kml", toKml());
      const blob = await zip.generateAsync({type:"blob", compression:"DEFLATE"});
      downloadBlob(blob, "freese-frame-sample.kmz");
    } catch (_) { toast("Draw or import a tract boundary first."); }
  });

  $("export-csv").addEventListener("click", () => {
    if (!state.sample) return toast("Generate sample locations first.");
    const lines = ["plot_id,latitude,longitude,design"].concat(state.sample.features.map((f,i) => {
      const [lng,lat] = f.geometry.coordinates;
      return [i+1,lat,lng,state.sampleDesign].join(",");
    }));
    downloadBlob(new Blob([lines.join("\n")], {type:"text/csv"}), "freese-frame-sample.csv");
  });

  function collectProject() {
    return {
      app:"Freese Frame",
      version:1,
      savedAt:new Date().toISOString(),
      planning:{
        estimateType:$("estimate-type").value,
        populationSize:+$("population-size").value || 0,
        expectedMean:+$("expected-mean").value || 0,
        expectedCv:+$("expected-cv").value || 0,
        precision:+$("desired-precision").value || 0,
        confidence:+$("confidence-level").value,
        strata:$("has-strata").value,
        travelExpensive:$("travel-expensive").value
      },
      map:{
        boundary:state.boundary,
        sample:state.sample,
        design:$("map-design").value,
        target:+$("map-sample-count").value || 0,
        bearing:+$("grid-bearing").value || 0,
        edgeBufferFeet:+$("edge-buffer").value || 0,
        plotSizeAcres:+$("plot-size").value || 0
      },
      analysis:{
        values:$("sample-values").value,
        population:+$("analysis-population").value || 0,
        confidence:+$("analysis-confidence").value,
        expansion:+$("analysis-expansion").value || 1
      }
    };
  }

  $("save-project").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(collectProject(), null, 2)], {type:"application/json"});
    downloadBlob(blob, "freese-frame-project.json");
  });

  $("open-project").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      if (p.planning) {
        $("estimate-type").value = p.planning.estimateType || "continuous";
        $("population-size").value = p.planning.populationSize ?? 1000;
        $("expected-mean").value = p.planning.expectedMean ?? 100;
        $("expected-cv").value = p.planning.expectedCv ?? 50;
        $("desired-precision").value = p.planning.precision ?? 10;
        $("confidence-level").value = p.planning.confidence ?? .95;
        $("has-strata").value = p.planning.strata || "no";
        $("travel-expensive").value = p.planning.travelExpensive || "no";
      }
      if (p.analysis) {
        $("sample-values").value = p.analysis.values || "";
        $("analysis-population").value = p.analysis.population ?? 0;
        $("analysis-confidence").value = p.analysis.confidence ?? .95;
        $("analysis-expansion").value = p.analysis.expansion ?? 1;
      }
      if (p.map) {
        $("map-design").value = p.map.design || "random";
        $("map-sample-count").value = p.map.target || 30;
        $("grid-bearing").value = p.map.bearing || 0;
        $("edge-buffer").value = p.map.edgeBufferFeet || 0;
        $("plot-size").value = p.map.plotSizeAcres ?? .1;
        state.boundary = p.map.boundary || null;
        state.sample = p.map.sample || null;
        state.sampleDesign = p.map.design || "random";
        showView("map");
        initMap();
        drawnItems.clearLayers();
        if (state.boundary) {
          const layer = L.geoJSON(state.boundary).getLayers()[0];
          drawnItems.addLayer(layer);
          map.fitBounds(layer.getBounds(), {padding:[20,20]});
        }
        updateArea();
        if (state.sample) renderSample(state.sample, state.sampleDesign);
      }
      toast("Project opened.");
    } catch (_) {
      toast("Could not open that Freese Frame project file.");
    } finally {
      e.target.value = "";
    }
  });
})();