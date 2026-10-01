(() => {
  "use strict";

  const state = {
    boundary: null,
    sample: null,
    sampleDesign: "random",
    plannedN: 30,
    mapInitialized: false,
    lastPlan: null
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

  const $ = id => document.getElementById(id);
  const fmt = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString(undefined, {maximumFractionDigits:d}) : "—";

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
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

  function requireJStat() {
    if (!window.jStat) {
      toast("Statistical library did not load. Reload before calculating confidence limits.");
      return false;
    }
    return true;
  }

  function tCritical(confidence, df) {
    if (!requireJStat() || !(df > 0)) return NaN;
    return jStat.studentt.inv(1 - (1-confidence)/2, df);
  }

  function hideAllMethodFields() {
    ["proportion-fields","change-fields","stratified-fields","two-stage-fields"].forEach(id => $(id).classList.add("hidden"));
  }

  function syncPlanFields() {
    hideAllMethodFields();
    const type = $("estimate-type").value;
    const strata = $("has-strata").value === "yes";
    const travel = $("travel-expensive").value === "yes";

    $("mean-field").classList.toggle("hidden", type !== "continuous");
    $("cv-field").classList.toggle("hidden", type !== "continuous");
    $("precision-field").classList.toggle("hidden", type !== "continuous");

    if (type === "proportion") $("proportion-fields").classList.remove("hidden");
    if (type === "change") $("change-fields").classList.remove("hidden");
    if (type === "continuous" && strata) $("stratified-fields").classList.remove("hidden");
    if (type === "continuous" && !strata && travel) $("two-stage-fields").classList.remove("hidden");
  }

  ["estimate-type","has-strata","travel-expensive"].forEach(id => $(id).addEventListener("change", syncPlanFields));
  syncPlanFields();

  function estimateSrsSampleSizeFromSd(sd, E, confidence, N) {
    if (!(sd > 0) || !(E > 0) || !requireJStat()) return null;
    const z = jStat.normal.inv(1 - (1-confidence)/2, 0, 1);
    let n = N > 0
      ? Math.ceil(1 / ((E*E)/(z*z*sd*sd) + 1/N))
      : Math.ceil((z*z*sd*sd)/(E*E));
    n = Math.max(2, n);

    for (let i=0; i<20; i++) {
      const t = tCritical(confidence, Math.max(1,n-1));
      if (!Number.isFinite(t)) return null;
      const next = N > 0
        ? Math.ceil(1 / ((E*E)/(t*t*sd*sd) + 1/N))
        : Math.ceil((t*t*sd*sd)/(E*E));
      if (next === n) break;
      n = Math.max(2, next);
    }
    if (N > 0) n = Math.min(n, N);
    return n;
  }

  function estimateContinuousPlan() {
    const mean = +$("expected-mean").value;
    const cv = +$("expected-cv").value;
    const relPrecision = +$("desired-precision").value;
    const confidence = +$("confidence-level").value;
    const N = +$("population-size").value || 0;
    const sd = mean * cv / 100;
    const E = Math.abs(mean * relPrecision / 100);
    const n = estimateSrsSampleSizeFromSd(sd,E,confidence,N);
    if (!n) return null;
    return {
      n, sd, E, confidence,
      design:"Simple random",
      summary:"Sample size is calculated from Freese's simple-random-sampling equation with iterative Student's t and the finite-population term when N is supplied.",
      unitLabel:"sampling units",
      confidenceLabel:Math.round(confidence*100)+"%"
    };
  }

  function estimateProportionPlan() {
    const P = (+$("expected-proportion").value)/100;
    const E = (+$("proportion-precision").value)/100;
    const confidence = +$("confidence-level").value;
    const N = +$("population-size").value || 0;
    if (!(P>0 && P<1) || !(E>0)) return null;

    let k, modern = false;
    if (Math.abs(confidence-.95)<.001) k = 4;
    else if (Math.abs(confidence-.99)<.001) k = 6.76;
    else {
      if (!requireJStat()) return null;
      const z = jStat.normal.inv(1-(1-confidence)/2,0,1);
      k = z*z;
      modern = true;
    }
    const n = Math.ceil(1 / (E*E/(k*P*(1-P)) + (N>0 ? 1/N : 0)));
    return {
      n: N>0 ? Math.min(n,N) : n,
      sd:Math.sqrt(P*(1-P)),
      E,
      confidence,
      design:"Simple random — proportion",
      summary: modern
        ? "The 90% calculation is a Modern Implementation using the corresponding normal critical value; Freese prints planning equations for 95% and 99%."
        : "Calculated from Freese's large-sample proportion equation, including the finite-population term when N is supplied.",
      unitLabel:"observations",
      confidenceLabel:Math.round(confidence*100)+"%",
      modern
    };
  }

  function parseStrata() {
    const lines = $("strata-input").value.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      const p = line.split(",").map(s=>s.trim());
      const N = +p[1], sd = +p[2], cost = p[3] === undefined ? 1 : +p[3];
      if (!p[0] || !(N>0) || !(sd>0) || !(cost>0)) return null;
      rows.push({name:p[0],N,sd,cost});
    }
    return rows.length ? rows : null;
  }

  function allocateIntegers(rows, n, weightFn) {
    const weights = rows.map(weightFn);
    const sum = weights.reduce((a,b)=>a+b,0);
    const raw = weights.map(w=>n*w/sum);
    const alloc = raw.map((x,i)=>Math.min(rows[i].N,Math.floor(x)));
    let left = Math.max(0,n-alloc.reduce((a,b)=>a+b,0));
    const order = raw.map((x,i)=>({i,frac:x-Math.floor(x)})).sort((a,b)=>b.frac-a.frac);
    let cursor = 0;
    while (left>0 && cursor < order.length*3) {
      const i = order[cursor % order.length].i;
      if (alloc[i] < rows[i].N) { alloc[i]++; left--; }
      cursor++;
    }
    return alloc;
  }

  function stratifiedSize(rows, D, method, populationN) {
    const sumNVar=rows.reduce((sum,r)=>sum+r.N*r.sd*r.sd,0);
    if(method==="proportional") return Math.ceil((populationN*sumNVar)/(populationN*populationN*D*D+sumNVar));
    if(method==="optimum") {
      const a=rows.reduce((sum,r)=>sum+r.N*r.sd,0);
      return Math.ceil((a*a)/(populationN*populationN*D*D+sumNVar));
    }
    const a=rows.reduce((sum,r)=>sum+r.N*r.sd*Math.sqrt(r.cost),0);
    const b=rows.reduce((sum,r)=>sum+r.N*r.sd/Math.sqrt(r.cost),0);
    return Math.ceil((a*b)/(populationN*populationN*D*D+sumNVar));
  }

  function stratifiedWeights(rows,method) {
    if(method==="proportional") return rows.map(r=>r.N);
    if(method==="optimum") return rows.map(r=>r.N*r.sd);
    return rows.map(r=>r.N*r.sd/Math.sqrt(r.cost));
  }

  function allocateStratifiedFreese(rows,D,method) {
    const populationN=rows.reduce((sum,r)=>sum+r.N,0);
    let active=rows.map((r,i)=>({...r,originalIndex:i}));
    const final=new Array(rows.length).fill(0);
    let censusCount=0;

    for(let guard=0;guard<rows.length+2 && active.length;guard++) {
      const nActive=stratifiedSize(active,D,method,populationN);
      const weights=stratifiedWeights(active,method);
      const wsum=weights.reduce((a,b)=>a+b,0);
      const raw=weights.map(w=>nActive*w/wsum);
      const offenders=active.filter((r,i)=>raw[i]>=r.N);

      if(!offenders.length) {
        const temp=active.map((r,i)=>({r,raw:raw[i]}));
        temp.forEach(x=>final[x.r.originalIndex]=Math.floor(x.raw));
        let left=nActive-temp.reduce((sum,x)=>sum+Math.floor(x.raw),0);
        temp.sort((a,b)=>(b.raw-Math.floor(b.raw))-(a.raw-Math.floor(a.raw)));
        for(let i=0;i<temp.length && left>0;i++) {
          const idx=temp[i].r.originalIndex;
          if(final[idx]<rows[idx].N){final[idx]++;left--;}
        }
        return {alloc:final,total:final.reduce((a,b)=>a+b,0),censusCount};
      }

      const offenderIds=new Set(offenders.map(r=>r.originalIndex));
      offenders.forEach(r=>{final[r.originalIndex]=r.N;censusCount+=r.N;});
      active=active.filter(r=>!offenderIds.has(r.originalIndex));
    }
    return {alloc:final,total:final.reduce((a,b)=>a+b,0),censusCount};
  }

  function estimateStratifiedPlan() {
    const rows=parseStrata();
    const D=+$("stratified-d").value;
    const method=$("stratified-allocation").value;
    if(!rows || !(D>0)) return null;

    const allocation=allocateStratifiedFreese(rows,D,method);
    const labels={
      proportional:"Stratified random — proportional allocation",
      optimum:"Stratified random — optimum allocation",
      "optimum-cost":"Stratified random — optimum allocation with varying costs"
    };
    return {
      n:allocation.total,sd:NaN,E:D,confidence:NaN,design:labels[method],rows,alloc:allocation.alloc,
      summary:"Calculated from Freese's stratified-random-sampling sample-size equation. If an allocation reaches a stratum's full size, that stratum is censused and the remaining allocation is recomputed as Freese directs.",
      unitLabel:"total observations",confidenceLabel:"SE target "+fmt(D,3)
    };
  }

  function estimateTwoStagePlan() {
    const N = +$("two-n-primary").value;
    const M = +$("two-m-total").value;
    const varBetween = +$("two-var-between").value;
    const varWithin = +$("two-var-within").value;
    const cp = +$("two-cost-primary").value;
    const cs = +$("two-cost-secondary").value;
    const D = +$("two-d").value;
    if (![N,M,varBetween,varWithin,cp,cs,D].every(x=>x>0)) return null;

    let m0 = Math.sqrt((varWithin/varBetween)*(cp/cs));
    m0 = Math.min(M, Math.max(1,m0));

    function nForM(m) {
      return (varBetween + varWithin/m) /
        (D*D + (1/N)*(varBetween + varWithin/M));
    }

    const candidates = [...new Set([Math.max(1,Math.floor(m0)), Math.min(M,Math.ceil(m0))])];
    const evaluated = candidates.map(m => {
      const n = Math.ceil(nForM(m));
      const cost = n*cp + n*m*cs;
      return {m,n,cost};
    }).sort((a,b)=>a.cost-b.cost);

    const best = evaluated[0];
    return {
      n:best.n, sd:Math.sqrt(varBetween+varWithin/best.m), E:D, confidence:NaN,
      design:"Two-stage sampling",
      summary:"Freese optimum: " + best.n + " primary units with " + best.m + " secondaries per primary (about " + (best.n*best.m) + " secondary observations). The integer choice is the lower-cost neighbor of Freese's continuous optimum m₀ = " + fmt(m0,2) + ".",
      unitLabel:"primary units",
      confidenceLabel:"SE target " + fmt(D,3),
      twoStage:best
    };
  }

  function estimateChangePlan() {
    const sd = +$("change-sd").value;
    const E = +$("change-precision").value;
    const confidence = +$("confidence-level").value;
    const N = +$("population-size").value || 0;
    const n = estimateSrsSampleSizeFromSd(sd,E,confidence,N);
    if (!n) return null;
    return {
      n,sd,E,confidence,design:"Permanent plots — change as differences",
      summary:"Modern Implementation of Freese's permanent-plot method: treat each plot's change dᵢ as the sampled variable, then plan the sample using its expected SD.",
      unitLabel:"permanent plots", confidenceLabel:Math.round(confidence*100)+"%"
    };
  }

  $("calculate-plan").addEventListener("click", () => {
    const type = $("estimate-type").value;
    const strata = $("has-strata").value === "yes";
    const travel = $("travel-expensive").value === "yes";

    let result;
    if (type === "proportion") {
      if (strata || travel) return toast("Stratified/two-stage attribute planning is not yet exposed; turn those options off for this calculation.");
      result = estimateProportionPlan();
    } else if (type === "change") {
      if (strata || travel) return toast("Change planning currently uses permanent-plot differences without stratified/two-stage layering.");
      result = estimateChangePlan();
    } else if (strata) result = estimateStratifiedPlan();
    else if (travel) result = estimateTwoStagePlan();
    else result = estimateContinuousPlan();

    if (!result) return toast("Check the method-specific inputs and try again.");

    state.lastPlan = result;
    state.plannedN = result.n;
    $("map-sample-count").value = result.n;
    $("recommended-n").textContent = result.n.toLocaleString();
    $("recommended-unit-label").textContent = result.unitLabel;
    $("expected-sd").textContent = Number.isFinite(result.sd) ? fmt(result.sd,3) : "Varies by stratum";
    $("absolute-precision").textContent = type === "proportion" ? "±"+fmt(result.E*100,2)+" points" : "±"+fmt(result.E,3);
    $("result-confidence").textContent = result.confidenceLabel;
    $("suggested-design").textContent = result.design;
    $("plan-summary").textContent = result.summary;

    const out = $("allocation-output");
    if (result.rows) {
      out.innerHTML = "<strong>Freese allocation</strong><table><thead><tr><th>Stratum</th><th>N</th><th>SD</th><th>Allocated n</th></tr></thead><tbody>" +
        result.rows.map((r,i)=>"<tr><td>"+escapeHtml(r.name)+"</td><td>"+r.N+"</td><td>"+fmt(r.sd,2)+"</td><td>"+result.alloc[i]+"</td></tr>").join("") +
        "</tbody></table>";
      out.classList.remove("hidden");
    } else {
      out.innerHTML = "";
      out.classList.add("hidden");
    }
    $("plan-result").classList.remove("hidden");
    toast("Sample plan calculated with the selected method.");
  });

  function syncAnalysisFields() {
    const type = $("analysis-type").value;
    $("continuous-analysis-fields").classList.toggle("hidden", type === "proportion");
    $("proportion-analysis-fields").classList.toggle("hidden", type !== "proportion");
    $("systematic-warning").classList.toggle("hidden", type !== "systematic");
  }
  $("analysis-type").addEventListener("change", syncAnalysisFields);
  syncAnalysisFields();

  function resetAnalysisLabels() {
    $("stat-n-label").textContent = "Observations";
    $("stat-mean-label").textContent = "Mean";
    $("stat-sd-label").textContent = "Std. deviation";
    $("stat-cv-label").textContent = "Coefficient of variation";
  }

  function analyzeContinuous(systematic=false) {
    const values = $("sample-values").value.split(/[\s,;]+/).map(Number).filter(Number.isFinite);
    if (values.length < 2) return toast("Enter at least two numeric observations.");
    const n = values.length;
    const mean = values.reduce((a,b)=>a+b,0)/n;
    const variance = values.reduce((s,x)=>s+(x-mean)**2,0)/(n-1);
    const sd = Math.sqrt(variance);
    const cv = mean !== 0 ? sd/Math.abs(mean)*100 : NaN;
    const N = +$("analysis-population").value || 0;
    const fpc = N>0 && n<=N ? Math.sqrt(Math.max(0,1-n/N)) : 1;
    const se = sd/Math.sqrt(n)*fpc;
    const expand = +$("analysis-expansion").value || 1;

    resetAnalysisLabels();
    $("stat-n").textContent=n;
    $("stat-mean").textContent=fmt(mean,3);
    $("stat-sd").textContent=fmt(sd,3);
    $("stat-cv").textContent=fmt(cv,1)+"%";
    $("stat-expanded").textContent=fmt(mean*expand,2);

    if (systematic) {
      $("stat-se").textContent="Not asserted";
      $("stat-ci").textContent="Not asserted";
      $("stat-expanded-se").textContent="Not asserted";
    } else {
      const confidence=+$("analysis-confidence").value;
      const t=tCritical(confidence,n-1);
      if (!Number.isFinite(t)) return;
      const lo=mean-t*se, hi=mean+t*se;
      $("stat-se").textContent=fmt(se,3);
      $("stat-ci").textContent=fmt(lo,2)+" – "+fmt(hi,2);
      $("stat-expanded-se").textContent=fmt(se*expand,2);
    }
    $("analysis-results").classList.remove("hidden");
  }

  function exactBinomialInterval(x,n,confidence) {
    if (!requireJStat()) return null;
    const alpha=1-confidence;
    const lo = x===0 ? 0 : jStat.beta.inv(alpha/2,x,n-x+1);
    const hi = x===n ? 1 : jStat.beta.inv(1-alpha/2,x+1,n-x);
    return [lo,hi];
  }

  function analyzeProportion() {
    const x=+$("analysis-successes").value;
    const n=+$("analysis-trials").value;
    const N=+$("analysis-population").value||0;
    const confidence=+$("analysis-confidence").value;
    if (!(n>0) || x<0 || x>n) return toast("Successes must be between 0 and the number observed.");
    const p=x/n;
    const fpc=N>0 && n<=N ? Math.max(0,1-n/N) : 1;
    const se=Math.sqrt((p*(1-p)/(Math.max(1,n-1)))*fpc);
    const ci=exactBinomialInterval(x,n,confidence);
    if (!ci) return;

    $("stat-n-label").textContent="Observed";
    $("stat-mean-label").textContent="Estimated proportion";
    $("stat-sd-label").textContent="Successes";
    $("stat-cv-label").textContent="Method";
    $("stat-n").textContent=n;
    $("stat-mean").textContent=fmt(p*100,2)+"%";
    $("stat-sd").textContent=x;
    $("stat-cv").textContent="Exact binomial CI";
    $("stat-se").textContent=fmt(se*100,3)+" points";
    $("stat-ci").textContent=fmt(ci[0]*100,2)+"% – "+fmt(ci[1]*100,2)+"%";
    $("stat-expanded").textContent="—";
    $("stat-expanded-se").textContent="—";
    $("analysis-results").classList.remove("hidden");
  }

  $("analyze-values").addEventListener("click", () => {
    const type=$("analysis-type").value;
    if (type==="proportion") analyzeProportion();
    else analyzeContinuous(type==="systematic");
  });

  let map, drawnItems, sampleLayer, plotBoundaryLayer;

  function initMap() {
    if (state.mapInitialized) return;
    state.mapInitialized=true;
    map=L.map("map",{zoomControl:true}).setView([44.4,-72.7],8);

    const streets=L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,crossOrigin:true,attribution:"&copy; OpenStreetMap contributors"});
    const imagery=L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,crossOrigin:true,attribution:"Tiles &copy; Esri and imagery providers"}).addTo(map);
    L.control.layers({"Aerial imagery":imagery,"Street map":streets},null,{position:"topright"}).addTo(map);

    drawnItems=new L.FeatureGroup().addTo(map);
    sampleLayer=new L.FeatureGroup().addTo(map);
    plotBoundaryLayer=new L.FeatureGroup().addTo(map);

    map.addControl(new L.Control.Draw({
      position:"topleft",
      edit:{featureGroup:drawnItems,remove:true},
      draw:{polyline:false,rectangle:true,circle:false,circlemarker:false,marker:false,polygon:{allowIntersection:false,showArea:true}}
    }));

    map.on(L.Draw.Event.CREATED,e=>{
      drawnItems.clearLayers(); drawnItems.addLayer(e.layer);
      state.boundary=e.layer.toGeoJSON(); updateArea(); clearSample();
    });
    map.on(L.Draw.Event.EDITED,()=>{
      const layers=drawnItems.getLayers();
      if(layers.length) state.boundary=layers[0].toGeoJSON();
      updateArea(); clearSample();
    });
    map.on(L.Draw.Event.DELETED,()=>{
      state.boundary=null; updateArea(); clearSample();
    });
  }

  function clearSample() {
    state.sample=null;
    if(sampleLayer) sampleLayer.clearLayers();
    if(plotBoundaryLayer) plotBoundaryLayer.clearLayers();
    $("generated-count").textContent="0";
    $("layout-note").textContent="—";
  }

  function updateArea() {
    if(!state.boundary){$("mapped-acres").textContent="0 acres";return;}
    $("mapped-acres").textContent=fmt(turf.area(state.boundary)/4046.8564224,2)+" acres";
  }

  function workingPolygon() {
    if(!state.boundary) return null;
    const ft=+$("edge-buffer").value||0;
    if(ft<=0) return state.boundary;
    if(!$("buffer-ack").checked) {
      toast("An edge buffer changes the sampling population. Check the acknowledgement before using it.");
      return null;
    }
    try {
      const b=turf.buffer(state.boundary,-ft*0.3048,{units:"meters"});
      if(!b || !b.geometry || turf.area(b)<=0) {
        toast("That edge buffer removes the entire sampling population.");
        return null;
      }
      return b;
    } catch(_) {
      toast("Could not apply that edge buffer.");
      return null;
    }
  }

  function randomPointsInPolygon(poly,count) {
    const bbox=turf.bbox(poly), features=[];
    let tries=0, maxTries=Math.max(10000,count*2000);
    while(features.length<count && tries<maxTries) {
      tries++;
      const p=turf.point([
        bbox[0]+Math.random()*(bbox[2]-bbox[0]),
        bbox[1]+Math.random()*(bbox[3]-bbox[1])
      ]);
      if(turf.booleanPointInPolygon(p,poly)) features.push(p);
    }
    return turf.featureCollection(features);
  }

  function systematicPoints(poly,target,bearing) {
    const area=turf.area(poly);
    let spacingKm=Math.sqrt(area/Math.max(1,target))/1000;
    const center=turf.centroid(poly);
    let best=null, bestDiff=Infinity;

    for(let attempt=0;attempt<30;attempt++) {
      const expanded=turf.buffer(poly,spacingKm*2,{units:"kilometers"});
      const bbox=turf.bbox(expanded);
      let grid=turf.pointGrid(bbox,spacingKm,{units:"kilometers"});
      const dx=(Math.random()-.5)*spacingKm;
      const dy=(Math.random()-.5)*spacingKm;
      grid=turf.featureCollection(grid.features.map(f=>{
        let g=turf.transformTranslate(f,Math.abs(dx),dx>=0?90:270,{units:"kilometers"});
        g=turf.transformTranslate(g,Math.abs(dy),dy>=0?0:180,{units:"kilometers"});
        return g;
      }));
      if(bearing) grid=turf.transformRotate(grid,bearing,{pivot:center.geometry.coordinates});
      const inside=turf.featureCollection(grid.features.filter(p=>turf.booleanPointInPolygon(p,poly)));
      const diff=Math.abs(inside.features.length-target);
      if(diff<bestDiff){best=inside;bestDiff=diff;}
      if(diff===0) break;
      const count=Math.max(1,inside.features.length);
      const ratio=Math.sqrt(count/target);
      spacingKm*=Math.max(.82,Math.min(1.18,ratio));
    }
    return best || turf.featureCollection([]);
  }

  function circleRadiusMeters(acres) {
    return acres>0 ? Math.sqrt(acres*4046.8564224/Math.PI) : 0;
  }

  function renderSample(fc,design) {
    sampleLayer.clearLayers(); plotBoundaryLayer.clearLayers();
    const acres=+$("plot-size").value||0;
    const radius=circleRadiusMeters(acres);
    const color=design==="random"?"#d98b24":"#2767b2";

    fc.features.forEach((f,i)=>{
      f.properties={...f.properties,plot_id:i+1,design,plot_acres:acres};
      const [lng,lat]=f.geometry.coordinates;
      const flamingoIcon=L.divIcon({
        className:"flamingo-marker-wrap",
        html:'<div class="flamingo-marker" aria-label="Plot '+(i+1)+'"><span class="flamingo-emoji">🦩</span><span class="flamingo-number">'+(i+1)+'</span></div>',
        iconSize:[34,42],
        iconAnchor:[17,36],
        popupAnchor:[0,-34]
      });
      sampleLayer.addLayer(
        L.marker([lat,lng],{icon:flamingoIcon})
          .bindPopup("<strong>Plot "+(i+1)+"</strong><br>"+lat.toFixed(6)+", "+lng.toFixed(6)+"<br>Design: "+design)
      );
      if(radius>0) plotBoundaryLayer.addLayer(L.circle([lat,lng],{radius,color,weight:1,fillOpacity:.04,opacity:.75,interactive:false}));
    });

    $("generated-count").textContent=fc.features.length;
    $("layout-note").textContent = design==="systematic"
      ? (fc.features.length===Math.round(+$("map-sample-count").value) ? "Exact target, regular spacing" : "Nearest regular grid to target")
      : "Independent random locations";
  }

  $("generate-sample").addEventListener("click",()=>{
    initMap();
    const poly=workingPolygon();
    if(!poly) return;
    const count=Math.max(1,Math.round(+$("map-sample-count").value||0));
    const design=$("map-design").value;
    let fc;
    if(state.lastPlan?.rows) {
      if(!state.strata || state.strata.features.length!==state.lastPlan.rows.length) {
        return toast("This is a stratified plan. Import one polygon per stratum, in the same order as the planning table, before generating locations.");
      }
      const features=[];
      state.strata.features.forEach((stratum,i)=>{
        const ni=state.lastPlan.alloc[i];
        const part=design==="random" ? randomPointsInPolygon(stratum,ni) : systematicPoints(stratum,ni,+$("grid-bearing").value||0);
        part.features.forEach(p=>{p.properties={...p.properties,stratum:state.lastPlan.rows[i].name};features.push(p);});
      });
      fc=turf.featureCollection(features);
    } else {
      fc=design==="random" ? randomPointsInPolygon(poly,count) : systematicPoints(poly,count,+$("grid-bearing").value||0);
    }
    if(!fc.features.length) return toast("No sample locations could be generated with those settings.");
    state.sample=fc; state.sampleDesign=design; renderSample(fc,design);
    toast("Generated "+fc.features.length+" sample locations.");
  });

  $("clear-sample").addEventListener("click",clearSample);

  function coordsTextToRing(text) {
    return text.trim().split(/\s+/).map(s=>{
      const p=s.split(",").map(Number);
      return [p[0],p[1]];
    }).filter(c=>Number.isFinite(c[0])&&Number.isFinite(c[1]));
  }

  function kmlToGeoJSON(kmlText) {
    const doc=new DOMParser().parseFromString(kmlText,"text/xml");
    if(doc.querySelector("parsererror")) throw new Error("Invalid KML");
    const polygons=[...doc.getElementsByTagName("Polygon")].map(poly=>{
      const outer=poly.getElementsByTagName("outerBoundaryIs")[0]?.getElementsByTagName("coordinates")[0]?.textContent;
      if(!outer) return null;
      const rings=[coordsTextToRing(outer)];
      [...poly.getElementsByTagName("innerBoundaryIs")].forEach(inner=>{
        const c=inner.getElementsByTagName("coordinates")[0]?.textContent;
        if(c) rings.push(coordsTextToRing(c));
      });
      return rings;
    }).filter(Boolean);
    if(!polygons.length) throw new Error("No polygon");
    return polygons.length===1
      ? turf.polygon(polygons[0],{source:"KML"})
      : turf.multiPolygon(polygons,{source:"KML"});
  }

  async function loadBoundaryFile(file) {
    const ext=file.name.toLowerCase().split(".").pop();
    if(ext==="kmz") {
      const zip=await JSZip.loadAsync(await file.arrayBuffer());
      const name=Object.keys(zip.files).find(n=>n.toLowerCase().endsWith(".kml"));
      if(!name) throw new Error("No KML in KMZ");
      const feature=kmlToGeoJSON(await zip.files[name].async("text"));
      const strata=feature.geometry.type==="MultiPolygon"
        ? turf.featureCollection(feature.geometry.coordinates.map((c,i)=>turf.polygon(c,{name:"Stratum "+(i+1)})))
        : null;
      return {boundary:feature,strata};
    }
    const text=await file.text();
    if(ext==="kml") {
      const feature=kmlToGeoJSON(text);
      const strata=feature.geometry.type==="MultiPolygon"
        ? turf.featureCollection(feature.geometry.coordinates.map((c,i)=>turf.polygon(c,{name:"Stratum "+(i+1)})))
        : null;
      return {boundary:feature,strata};
    }
    const json=JSON.parse(text);
    if(json.type==="FeatureCollection") {
      const polys=json.features.filter(f=>f.geometry && /Polygon/.test(f.geometry.type));
      if(!polys.length) throw new Error("No polygon");
      const strata=turf.featureCollection(polys.flatMap(f=>{
        if(f.geometry.type==="Polygon") return [f];
        return f.geometry.coordinates.map((c,i)=>turf.polygon(c,{...(f.properties||{}),part:i+1}));
      }));
      if(strata.features.length===1) return {boundary:strata.features[0],strata:null};
      return {boundary:turf.multiPolygon(strata.features.map(f=>f.geometry.coordinates),{source:"GeoJSON"}),strata};
    }
    if(!json.geometry || !/Polygon/.test(json.geometry.type)) throw new Error("No polygon");
    const strata=json.geometry.type==="MultiPolygon"
      ? turf.featureCollection(json.geometry.coordinates.map((c,i)=>turf.polygon(c,{name:"Stratum "+(i+1)})))
      : null;
    return {boundary:json,strata};
  }

  $("boundary-upload").addEventListener("change",async e=>{
    initMap();
    const file=e.target.files[0]; if(!file) return;
    try {
      const loaded=await loadBoundaryFile(file);
      drawnItems.clearLayers();
      const group=L.geoJSON(loaded.boundary);
      group.eachLayer(layer=>drawnItems.addLayer(layer));
      state.boundary=loaded.boundary;
      state.strata=loaded.strata;
      updateArea(); clearSample();
      map.fitBounds(group.getBounds(),{padding:[20,20]});
      toast("Boundary imported from "+file.name+".");
    } catch(err) {
      toast("Could not import a polygon from that file.");
    } finally { e.target.value=""; }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;","'":"&apos;",'"':"&quot;"}[c]));
  }

  function polygonKml(coords) {
    const ringKml = ring => ring.map(c=>c[0]+","+c[1]+",0").join(" ");
    const outer="<outerBoundaryIs><LinearRing><coordinates>"+ringKml(coords[0])+"</coordinates></LinearRing></outerBoundaryIs>";
    const inners=coords.slice(1).map(r=>"<innerBoundaryIs><LinearRing><coordinates>"+ringKml(r)+"</coordinates></LinearRing></innerBoundaryIs>").join("");
    return "<Polygon>"+outer+inners+"</Polygon>";
  }

  function geometryToKml(geometry) {
    if(geometry.type==="Polygon") return polygonKml(geometry.coordinates);
    if(geometry.type==="MultiPolygon") return "<MultiGeometry>"+geometry.coordinates.map(polygonKml).join("")+"</MultiGeometry>";
    return "";
  }

  function toKml() {
    if(!state.boundary) throw new Error("No boundary");
    const marks=[];
    marks.push("<Placemark><name>Tract Boundary</name><Style><LineStyle><color>ff2f4523</color><width>3</width></LineStyle><PolyStyle><color>332f4523</color></PolyStyle></Style>"+geometryToKml(state.boundary.geometry)+"</Placemark>");
    if(state.strata) state.strata.features.forEach((f,i)=>{
      const name=state.lastPlan?.rows?.[i]?.name || f.properties?.name || ("Stratum "+(i+1));
      marks.push("<Placemark><name>"+escapeXml(name)+"</name><Style><LineStyle><width>2</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>"+geometryToKml(f.geometry)+"</Placemark>");
    });

    const plotAcres=+$("plot-size").value||0;
    if(state.sample) state.sample.features.forEach((f,i)=>{
      const [lng,lat]=f.geometry.coordinates;
      marks.push("<Placemark><name>Plot "+(i+1)+" Center</name><description>"+escapeXml("Design: "+state.sampleDesign)+"</description><Point><coordinates>"+lng+","+lat+",0</coordinates></Point></Placemark>");
      if(plotAcres>0) {
        const circle=turf.circle(f,circleRadiusMeters(plotAcres),{units:"meters",steps:48});
        marks.push("<Placemark><name>Plot "+(i+1)+" Boundary</name>"+geometryToKml(circle.geometry)+"</Placemark>");
      }
    });

    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Freese Frame Sample</name>' +
      marks.join("") + "</Document></kml>";
  }

  function downloadBlob(blob,filename) {
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),500);
  }

  $("export-kml").addEventListener("click",()=>{
    try{downloadBlob(new Blob([toKml()],{type:"application/vnd.google-earth.kml+xml"}),"freese-frame-sample.kml");}
    catch(_){toast("Draw or import a tract boundary first.");}
  });

  $("export-kmz").addEventListener("click",async()=>{
    try{
      const zip=new JSZip();zip.file("doc.kml",toKml());
      downloadBlob(await zip.generateAsync({type:"blob",compression:"DEFLATE"}),"freese-frame-sample.kmz");
    }catch(_){toast("Draw or import a tract boundary first.");}
  });

  $("export-csv").addEventListener("click",()=>{
    if(!state.sample) return toast("Generate sample locations first.");
    const lines=["plot_id,latitude,longitude,design,plot_acres"].concat(state.sample.features.map((f,i)=>{
      const [lng,lat]=f.geometry.coordinates;
      return [i+1,lat,lng,state.sampleDesign,+$("plot-size").value||0].join(",");
    }));
    downloadBlob(new Blob([lines.join("\n")],{type:"text/csv"}),"freese-frame-sample.csv");
  });

  function sanitizeFileName(name) {
    return String(name || "freese-frame").trim().replace(/[^a-z0-9_-]+/gi,"-").replace(/^-+|-+$/g,"") || "freese-frame";
  }

  function mapCornerControlPoints() {
    if(!map) return null;
    const b=map.getBounds();
    return {
      west:b.getWest(), south:b.getSouth(), east:b.getEast(), north:b.getNorth(),
      nw:[b.getNorth(),b.getWest()],
      sw:[b.getSouth(),b.getWest()],
      se:[b.getSouth(),b.getEast()],
      ne:[b.getNorth(),b.getEast()]
    };
  }

  function addGeoViewportToJsPdf(doc, mapBox, geo) {
    if(!doc?.internal?.events || !geo) return;
    const gpts=[
      geo.nw[0],geo.nw[1],
      geo.sw[0],geo.sw[1],
      geo.se[0],geo.se[1],
      geo.ne[0],geo.ne[1]
    ].map(n=>Number(n).toFixed(10)).join(" ");
    const bbox=[mapBox.x,mapBox.y,mapBox.x+mapBox.w,mapBox.y+mapBox.h].map(n=>Number(n).toFixed(3)).join(" ");
    const wkt='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';
    doc.internal.events.subscribe("putPage", function(data) {
      if(data.pageNumber!==1) return;
      doc.internal.write("/VP [<< /Type /Viewport /Name (Sadler PDF Map) /BBox ["+bbox+"] /Measure << /Type /Measure /Subtype /GEO /Bounds [0 1 0 0 1 0 1 1] /LPTS [0 1 0 0 1 0 1 1] /GPTS ["+gpts+"] /GCS << /Type /GEOGCS /WKT ("+wkt.replace(/[()]/g,"")+") >> >> >>]");
    });
  }

  async function buildSadlerPdfBlob() {
    initMap();
    if(!state.boundary) throw new Error("boundary");
    if(!window.html2canvas || !window.jspdf?.jsPDF) throw new Error("library");

    map.invalidateSize();
    await new Promise(resolve=>setTimeout(resolve,250));

    const mapEl=$("map");
    const canvas=await html2canvas(mapEl,{
      useCORS:true,
      allowTaint:false,
      backgroundColor:"#f5f3ec",
      scale:2,
      logging:false
    });

    const {jsPDF}=window.jspdf;
    const doc=new jsPDF({orientation:"landscape",unit:"pt",format:"letter",compress:true});
    const pageW=doc.internal.pageSize.getWidth();
    const pageH=doc.internal.pageSize.getHeight();

    const margin=34, headerH=58, footerH=52;
    const mapBox={x:margin,y:margin+headerH,w:pageW-margin*2,h:pageH-margin*2-headerH-footerH};
    const imgData=canvas.toDataURL("image/jpeg",0.92);
    doc.addImage(imgData,"JPEG",mapBox.x,mapBox.y,mapBox.w,mapBox.h,undefined,"FAST");

    const geo=mapCornerControlPoints();
    addGeoViewportToJsPdf(doc,mapBox,geo);

    doc.setFillColor(35,69,47);
    doc.rect(0,0,pageW,headerH+10,"F");
    doc.setTextColor(255,255,255);
    doc.setFont("helvetica","bold");
    doc.setFontSize(20);
    doc.text("Sadler PDF Map",margin,30);
    doc.setFont("helvetica","normal");
    doc.setFontSize(10);
    const design=state.sampleDesign==="systematic"?"Systematic grid":"Simple random";
    const count=state.sample?.features?.length || 0;
    doc.text("Freese Frame  •  "+design+"  •  "+count+" sample locations",margin,47);

    doc.setTextColor(35,40,36);
    doc.setFontSize(8.5);
    const acres=state.boundary ? turf.area(state.boundary)/4046.8564224 : 0;
    doc.text("Mapped population: "+fmt(acres,2)+" acres",margin,pageH-34);
    doc.text("WGS84 / EPSG:4326",margin,pageH-22);

    if(geo) {
      const extent="Extent: "+geo.west.toFixed(6)+", "+geo.south.toFixed(6)+"  to  "+geo.east.toFixed(6)+", "+geo.north.toFixed(6);
      doc.text(extent,margin+150,pageH-34);
      doc.text("Geospatial viewport: embedded WGS84 corner control points",margin+150,pageH-22);
    }

    doc.setFontSize(7.5);
    doc.text("Based on Frank Freese, Elementary Forest Sampling, USDA Forest Service Agriculture Handbook No. 232.",pageW-margin,pageH-22,{align:"right"});

    // Simple north arrow.
    const nx=pageW-margin-22, ny=margin+headerH+34;
    doc.setFillColor(255,255,255);
    doc.roundedRect(nx-16,ny-22,32,48,4,4,"F");
    doc.setTextColor(35,69,47);
    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.text("N",nx,ny-10,{align:"center"});
    doc.setLineWidth(1.2);
    doc.line(nx,ny+16,nx,ny-4);
    doc.line(nx,ny-4,nx-5,ny+3);
    doc.line(nx,ny-4,nx+5,ny+3);

    // Scale bar based on current map resolution at center.
    const center=map.getCenter();
    const zoom=map.getZoom();
    const metersPerPixel=156543.03392*Math.cos(center.lat*Math.PI/180)/Math.pow(2,zoom);
    const targetPx=120;
    const targetM=metersPerPixel*targetPx;
    const choices=[10,20,50,100,200,500,1000,2000,5000,10000];
    const scaleM=choices.reduce((best,v)=>Math.abs(v-targetM)<Math.abs(best-targetM)?v:best,choices[0]);
    const scalePx=scaleM/metersPerPixel;
    const scalePt=scalePx*(mapBox.w/mapEl.clientWidth);
    const sx=mapBox.x+24, sy=mapBox.y+mapBox.h-24;
    doc.setDrawColor(35,40,36);
    doc.setLineWidth(3);
    doc.line(sx,sy,sx+scalePt,sy);
    doc.setLineWidth(1);
    doc.line(sx,sy-5,sx,sy+5);
    doc.line(sx+scalePt,sy-5,sx+scalePt,sy+5);
    doc.setFillColor(255,255,255);
    doc.rect(sx-4,sy-18,Math.max(72,scalePt+8),14,"F");
    doc.setFont("helvetica","bold");
    doc.setFontSize(8);
    const scaleLabel=scaleM>=1000?(scaleM/1000)+" km":scaleM+" m";
    doc.text(scaleLabel,sx+scalePt/2,sy-8,{align:"center"});

    doc.setProperties({
      title:"Sadler PDF Map",
      subject:"Freese Frame georeferenced field map",
      author:"Freese Frame",
      keywords:"Sadler PDF Map, forest sampling, Frank Freese, GeoPDF, WGS84"
    });

    return doc.output("blob");
  }

  async function exportSadlerPdf() {
    try {
      const blob=await buildSadlerPdfBlob();
      downloadBlob(blob,"Sadler-PDF-Map.pdf");
      toast("Sadler PDF Map exported.");
      return blob;
    } catch(err) {
      if(err.message==="boundary") toast("Draw or import a tract boundary before exporting a Sadler PDF Map.");
      else if(err.message==="library") toast("PDF export libraries did not load. Reload the page and try again.");
      else toast("Could not create the Sadler PDF Map. Try the street basemap if aerial imagery blocks capture.");
      throw err;
    }
  }

  $("export-sadler-pdf")?.addEventListener("click",async()=>{
    try{await exportSadlerPdf();}catch(_){}
  });

  $("text-sadler-pdf")?.addEventListener("click",async()=>{
    try {
      const blob=await buildSadlerPdfBlob();
      const file=new File([blob],"Sadler-PDF-Map.pdf",{type:"application/pdf"});
      if(navigator.canShare && navigator.share && navigator.canShare({files:[file]})) {
        await navigator.share({
          title:"Sadler PDF Map",
          text:"Freese Frame Sadler PDF Map",
          files:[file]
        });
        toast("Sadler PDF Map opened in your device sharing options.");
        return;
      }
      downloadBlob(blob,"Sadler-PDF-Map.pdf");
      const body=encodeURIComponent("Sadler PDF Map from Freese Frame — the PDF has been downloaded to this device for attachment.");
      window.location.href="sms:?&body="+body;
      toast("PDF downloaded. Attach Sadler-PDF-Map.pdf to the text message.");
    } catch(err) {
      if(err && err.name==="AbortError") return;
      if(err.message==="boundary") toast("Draw or import a tract boundary before sharing a Sadler PDF Map.");
      else toast("Could not prepare the Sadler PDF Map for texting.");
    }
  });

  function collectProject() {
    return {
      app:"Freese Frame",version:2,savedAt:new Date().toISOString(),
      planning:{
        estimateType:$("estimate-type").value,populationSize:+$("population-size").value||0,
        expectedMean:+$("expected-mean").value||0,expectedCv:+$("expected-cv").value||0,
        precision:+$("desired-precision").value||0,confidence:+$("confidence-level").value,
        strata:$("has-strata").value,travelExpensive:$("travel-expensive").value,
        expectedProportion:+$("expected-proportion").value||0,proportionPrecision:+$("proportion-precision").value||0,
        changeSd:+$("change-sd").value||0,changePrecision:+$("change-precision").value||0,
        strataInput:$("strata-input").value,stratifiedAllocation:$("stratified-allocation").value,stratifiedD:+$("stratified-d").value||0,
        twoStage:{N:+$("two-n-primary").value||0,M:+$("two-m-total").value||0,varBetween:+$("two-var-between").value||0,varWithin:+$("two-var-within").value||0,cp:+$("two-cost-primary").value||0,cs:+$("two-cost-secondary").value||0,D:+$("two-d").value||0}
      },
      map:{boundary:state.boundary,strata:state.strata,sample:state.sample,design:$("map-design").value,target:+$("map-sample-count").value||0,bearing:+$("grid-bearing").value||0,edgeBufferFeet:+$("edge-buffer").value||0,bufferAcknowledged:$("buffer-ack").checked,plotSizeAcres:+$("plot-size").value||0},
      analysis:{type:$("analysis-type").value,values:$("sample-values").value,population:+$("analysis-population").value||0,confidence:+$("analysis-confidence").value,expansion:+$("analysis-expansion").value||1,successes:+$("analysis-successes").value||0,trials:+$("analysis-trials").value||0}
    };
  }

  $("save-project").addEventListener("click",()=>downloadBlob(new Blob([JSON.stringify(collectProject(),null,2)],{type:"application/json"}),"freese-frame-project.json"));

  $("open-project").addEventListener("change",async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      const p=JSON.parse(await file.text());
      const q=p.planning||{};
      $("estimate-type").value=q.estimateType||"continuous";
      $("population-size").value=q.populationSize??1000;
      $("expected-mean").value=q.expectedMean??100;
      $("expected-cv").value=q.expectedCv??50;
      $("desired-precision").value=q.precision??10;
      $("confidence-level").value=q.confidence??.95;
      $("has-strata").value=q.strata||"no";
      $("travel-expensive").value=q.travelExpensive||"no";
      if(q.expectedProportion!=null)$("expected-proportion").value=q.expectedProportion;
      if(q.proportionPrecision!=null)$("proportion-precision").value=q.proportionPrecision;
      if(q.changeSd!=null)$("change-sd").value=q.changeSd;
      if(q.changePrecision!=null)$("change-precision").value=q.changePrecision;
      if(q.strataInput!=null)$("strata-input").value=q.strataInput;
      if(q.stratifiedAllocation)$("stratified-allocation").value=q.stratifiedAllocation;
      if(q.stratifiedD!=null)$("stratified-d").value=q.stratifiedD;
      if(q.twoStage){
        $("two-n-primary").value=q.twoStage.N??1000;$("two-m-total").value=q.twoStage.M??100;
        $("two-var-between").value=q.twoStage.varBetween??366.8036;$("two-var-within").value=q.twoStage.varWithin??248.25;
        $("two-cost-primary").value=q.twoStage.cp??14;$("two-cost-secondary").value=q.twoStage.cs??1.2;$("two-d").value=q.twoStage.D??4.8;
      }
      syncPlanFields();

      const a=p.analysis||{};
      $("analysis-type").value=a.type||"srs";$("sample-values").value=a.values||"";
      $("analysis-population").value=a.population??0;$("analysis-confidence").value=a.confidence??.95;$("analysis-expansion").value=a.expansion??1;
      if(a.successes!=null)$("analysis-successes").value=a.successes;if(a.trials!=null)$("analysis-trials").value=a.trials;
      syncAnalysisFields();

      if(p.map){
        $("map-design").value=p.map.design||"random";$("map-sample-count").value=p.map.target||30;$("grid-bearing").value=p.map.bearing||0;
        $("edge-buffer").value=p.map.edgeBufferFeet||0;$("buffer-ack").checked=!!p.map.bufferAcknowledged;$("plot-size").value=p.map.plotSizeAcres??.1;
        state.boundary=p.map.boundary||null;state.strata=p.map.strata||null;state.sample=p.map.sample||null;state.sampleDesign=p.map.design||"random";
        showView("map");initMap();drawnItems.clearLayers();
        if(state.boundary){
          const group=L.geoJSON(state.boundary);group.eachLayer(layer=>drawnItems.addLayer(layer));map.fitBounds(group.getBounds(),{padding:[20,20]});
        }
        updateArea();if(state.sample)renderSample(state.sample,state.sampleDesign);
      }
      toast("Project opened.");
    }catch(_){toast("Could not open that Freese Frame project file.");}
    finally{e.target.value="";}
  });
})();