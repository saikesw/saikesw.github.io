(function (global) {
  "use strict";

  var Core = global.PhysicsCore;
  var FieldRenderer = global.FieldRenderer;
  var SurfaceRenderer = global.SurfaceRenderer;
  var SINGULARITY_RADIUS_CM = 0.6;
  var DEFAULT_LAYERS = {
    heatmap: true,
    "field-lines": true,
    equipotential: true,
    vectors: true,
    labels: true,
    animation: true
  };

  var PRESETS = {
    "single-positive": {
      q1: { x: 0, y: 0, q: 6 },
      q2: { x: 0.24, y: 0, q: 0 },
      probe: { x: 0.16, y: -0.10, q: 1 },
      A: { x: -0.25, y: 0.16 },
      B: { x: 0.25, y: 0.16 }
    },
    "equal-opposite": {
      q1: { x: -0.18, y: 0, q: 6 },
      q2: { x: 0.18, y: 0, q: -6 },
      probe: { x: 0, y: -0.14, q: 1 },
      A: { x: -0.27, y: 0.17 },
      B: { x: 0.27, y: 0.17 }
    },
    "equal-same": {
      q1: { x: -0.18, y: 0, q: 6 },
      q2: { x: 0.18, y: 0, q: 6 },
      probe: { x: 0, y: 0, q: 1 },
      A: { x: -0.27, y: 0.17 },
      B: { x: 0.27, y: 0.17 }
    },
    custom: {
      q1: { x: -0.20, y: -0.02, q: 8 },
      q2: { x: 0.17, y: 0.04, q: -4 },
      probe: { x: 0.03, y: -0.15, q: 1 },
      A: { x: -0.28, y: 0.17 },
      B: { x: 0.27, y: 0.16 }
    }
  };

  var QUIZ_EXPLANATIONS = {
    1: "电场线切线方向定义为该点电场方向，也就是正试探电荷的受力方向。",
    2: "等势面上两点电势差为零，因此 W = qU = 0，与路径长度无关。",
    3: "理想点电荷场强大小 E = k|Q|/r²，距离加倍时场强变为原来的 1/4。",
    4: "静电平衡时自由电荷不再定向移动，因此导体内部合电场必须为零。"
  };

  var dom = {};
  var state;
  var fieldRenderer;
  var surfaceRenderer;
  var currentPreset = "single-positive";
  var currentView = "field-lines";
  var measurements = [];
  var completedActivities = new Set();
  var readingCache = { signature: null, result: null };

  function byId(id) {
    return document.getElementById(id);
  }

  function all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function signed(value, digits) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (Math.abs(number) < Math.pow(10, -(digits || 1)) / 2) number = 0;
    return (number > 0 ? "+" : "") + number.toFixed(digits == null ? 1 : digits);
  }

  function formatAdaptive(value, unit, options) {
    options = options || {};
    if (!Number.isFinite(value)) return "未定义";
    if (value === 0) return "0 " + unit;
    var absolute = Math.abs(value);
    var scales = options.scales || [
      { threshold: 1e9, divisor: 1e9, prefix: "G" },
      { threshold: 1e6, divisor: 1e6, prefix: "M" },
      { threshold: 1e3, divisor: 1e3, prefix: "k" },
      { threshold: 1, divisor: 1, prefix: "" },
      { threshold: 1e-3, divisor: 1e-3, prefix: "m" },
      { threshold: 1e-6, divisor: 1e-6, prefix: "µ" },
      { threshold: 1e-9, divisor: 1e-9, prefix: "n" },
      { threshold: 0, divisor: 1e-12, prefix: "p" }
    ];
    var selected = scales[scales.length - 1];
    for (var index = 0; index < scales.length; index += 1) {
      if (absolute >= scales[index].threshold) {
        selected = scales[index];
        break;
      }
    }
    var scaled = value / selected.divisor;
    var digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    return scaled.toFixed(digits).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1") + " " + selected.prefix + unit;
  }

  function formatPotential(value) {
    return formatAdaptive(value, "V", {
      scales: [
        { threshold: 1e6, divisor: 1e6, prefix: "M" },
        { threshold: 1e3, divisor: 1e3, prefix: "k" },
        { threshold: 1, divisor: 1, prefix: "" },
        { threshold: 1e-3, divisor: 1e-3, prefix: "m" },
        { threshold: 0, divisor: 1e-6, prefix: "µ" }
      ]
    });
  }

  function formatEnergy(value) {
    return formatAdaptive(value, "J");
  }

  function metersPointToCm(point) {
    return { x: point.x * 100, y: point.y * 100 };
  }

  function physicsCharges() {
    return state.charges.map(function (charge) {
      return { id: charge.id, x: charge.x * 100, y: charge.y * 100, q: charge.q };
    });
  }

  function createStateFromPreset(name) {
    var preset = clone(PRESETS[name] || PRESETS["single-positive"]);
    var next = {
      chargeUnit: "nC",
      charges: [
        { id: "q1", label: "Q1", x: preset.q1.x, y: preset.q1.y, q: preset.q1.q },
        { id: "q2", label: "Q2", x: preset.q2.x, y: preset.q2.y, q: preset.q2.q }
      ],
      probe: { id: "probe", x: preset.probe.x, y: preset.probe.y, q: preset.probe.q },
      points: { A: preset.A, B: preset.B },
      pathType: "line",
      pathPoints: [],
      layers: clone(DEFAULT_LAYERS),
      view: { centerX: 0, centerY: 0, width: 0.8, height: 0.48 }
    };
    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      next.layers.animation = false;
    }
    return next;
  }

  function chargeById(id) {
    return state.charges.find(function (charge) { return String(charge.id) === String(id); });
  }

  function pathControlDefaults(type) {
    var a = state.points.A;
    var b = state.points.B;
    var midX = (a.x + b.x) / 2;
    var midY = (a.y + b.y) / 2;
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var length = Math.hypot(dx, dy) || 1;
    var nx = -dy / length;
    var ny = dx / length;

    if (type === "polyline") {
      return [{ id: "bend", x: midX - nx * 0.11, y: midY - ny * 0.11 }];
    }
    if (type === "arc") {
      return [{ id: "curve", x: midX + nx * 0.15, y: midY + ny * 0.15 }];
    }
    return [];
  }

  function setPreset(name, options) {
    options = options || {};
    if (!PRESETS[name]) return;
    currentPreset = name;
    var keepView = currentView;
    state = createStateFromPreset(name);
    currentView = keepView;
    measurements = [];
    readingCache.signature = null;
    updatePresetButtons();
    updateControls();
    renderMeasurementLog();
    syncRenderers(true);
    updateReadings();
    announce("已载入" + presetLabel(name) + "构型");
    if (options.complete) markActivity(options.complete);
  }

  function presetLabel(name) {
    return {
      "single-positive": "单正电荷",
      "equal-opposite": "等量异号",
      "equal-same": "等量同号",
      custom: "自定义双电荷"
    }[name] || name;
  }

  function updatePresetButtons() {
    all("[data-preset]").forEach(function (button) {
      var active = button.dataset.preset === currentPreset;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateViewButtons() {
    all("[data-view]").forEach(function (button) {
      var active = button.dataset.view === currentView;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setView(view) {
    if (view !== "field-lines" && view !== "potential-surface") return;
    currentView = view;
    var isSurface = view === "potential-surface";
    dom.fieldCanvas.hidden = isSurface;
    dom.surfaceCanvas.hidden = !isSurface;
    dom.canvasStage.dataset.renderTarget = isSurface ? "surface" : "field";
    dom.visualTitle.textContent = isSurface ? "三维电势地形" : "二维电场图谱";
    dom.canvasInstruction.textContent = isSurface
      ? "拖动旋转、滚轮缩放、双击恢复视角"
      : "拖动电荷、探针、A/B 点或路径控制点";
    dom.visualCaption.textContent = isSurface
      ? "曲面高度经过 asinh 压缩并裁剪，仅用于显示；实时数值仍由未软化的点电荷模型计算。"
      : "这是三维点电荷场在 z = 0 平面的截面；颜色和箭头长度采用压缩尺度，方向与数值由解析公式计算。";
    updateViewButtons();
    if (isSurface) {
      surfaceRenderer.resize();
      surfaceRenderer.invalidate(true);
    } else {
      fieldRenderer.resize();
      fieldRenderer.invalidate({ full: true });
    }
    announce(isSurface ? "已切换到三维电势地形" : "已切换到二维电场图谱");
  }

  function syncRenderers(full) {
    fieldRenderer.setState(state);
    if (full) fieldRenderer.invalidate({ full: true });
    surfaceRenderer.setState(state);
    if (full) surfaceRenderer.invalidate(true);
    updateStatus("计算稳定");
  }

  function updateStatus(text) {
    if (dom.renderState) dom.renderState.textContent = text;
  }

  function setCustomPreset() {
    if (currentPreset === "custom") return;
    currentPreset = "custom";
    updatePresetButtons();
  }

  function updateChargeIndicator(slider, value) {
    var output = byId(slider.id.replace("slider", "value"));
    if (output) output.textContent = signed(value, 1) + " nC";
    var indicator = slider.closest(".range-control").querySelector(".charge-indicator, .probe-indicator");
    if (!indicator) return;
    indicator.textContent = value > 0 ? "＋" : value < 0 ? "−" : "0";
    indicator.classList.toggle("charge-indicator-positive", value > 0);
    indicator.classList.toggle("charge-indicator-negative", value < 0);
  }

  function updateControls() {
    var q1 = chargeById("q1");
    var q2 = chargeById("q2");
    dom.q1Slider.value = q1.q;
    dom.q2Slider.value = q2.q;
    dom.testChargeSlider.value = state.probe.q;
    updateChargeIndicator(dom.q1Slider, q1.q);
    updateChargeIndicator(dom.q2Slider, q2.q);
    updateChargeIndicator(dom.testChargeSlider, state.probe.q);
    all("[data-layer]").forEach(function (input) {
      input.checked = state.layers[input.dataset.layer] !== false;
    });
    all("[data-path]").forEach(function (input) {
      input.checked = input.dataset.path === state.pathType;
    });
  }

  function onSliderInput(event) {
    var input = event.currentTarget;
    var value = Number(input.value);
    if (input.id === "q1-slider" || input.id === "q2-slider") {
      var charge = chargeById(input.dataset.chargeId);
      charge.q = value;
      setCustomPreset();
    } else {
      state.probe.q = value;
    }
    updateChargeIndicator(input, value);
    readingCache.signature = null;
    syncRenderers(true);
    updateReadings();
  }

  function onRendererChange(kind, id, point, metadata) {
    if (kind === "charge") {
      var charge = chargeById(id);
      if (charge) {
        charge.x = point.x;
        charge.y = point.y;
        setCustomPreset();
      }
    } else if (kind === "probe") {
      state.probe.x = point.x;
      state.probe.y = point.y;
    } else if (kind === "point") {
      if (state.points[id]) {
        state.points[id].x = point.x;
        state.points[id].y = point.y;
      }
    } else if (kind === "path") {
      var control = state.pathPoints.find(function (item) { return String(item.id) === String(id); });
      if (!control && metadata && Number.isInteger(metadata.index)) control = state.pathPoints[metadata.index];
      if (control) {
        control.x = point.x;
        control.y = point.y;
      }
    }

    readingCache.signature = null;
    updateReadings();
    if (metadata && metadata.phase === "end") {
      syncRenderers(true);
    } else if (currentView === "potential-surface" && kind === "charge") {
      surfaceRenderer.setState(state);
    }
  }

  function getReadings() {
    var signature = JSON.stringify({
      charges: state.charges.map(function (charge) { return [charge.x, charge.y, charge.q]; }),
      probe: [state.probe.x, state.probe.y, state.probe.q],
      A: state.points.A,
      B: state.points.B,
      pathType: state.pathType,
      pathPoints: state.pathPoints
    });
    if (readingCache.signature === signature) return readingCache.result;

    var charges = physicsCharges();
    var probeCm = metersPointToCm(state.probe);
    var aCm = metersPointToCm(state.points.A);
    var bCm = metersPointToCm(state.points.B);
    var field = Core.fieldAt(probeCm, charges, SINGULARITY_RADIUS_CM);
    var phi = Core.potentialAt(probeCm, charges, SINGULARITY_RADIUS_CM);
    var phiA = Core.potentialAt(aCm, charges, SINGULARITY_RADIUS_CM);
    var phiB = Core.potentialAt(bCm, charges, SINGULARITY_RADIUS_CM);
    var uAB = Number.isFinite(phiA) && Number.isFinite(phiB)
      ? Core.potentialDifference(phiA, phiB)
      : NaN;
    var deltaPhi = Number.isFinite(phiA) && Number.isFinite(phiB)
      ? Core.potentialChange(phiA, phiB)
      : NaN;
    var energy = Number.isFinite(phi) ? Core.potentialEnergy(state.probe.q, phi) : NaN;
    var work = Number.isFinite(uAB) ? Core.electricWork(state.probe.q, phiA, phiB) : NaN;
    var path = buildPhysicsPath();
    var pathIntegral = Core.lineIntegral(path, charges, {
      singularityRadius: SINGULARITY_RADIUS_CM,
      tolerance: 1e-7,
      maxDepth: 18
    });
    var distances = state.charges.map(function (charge) {
      return Math.hypot(state.probe.x - charge.x, state.probe.y - charge.y) * 100;
    });

    readingCache.signature = signature;
    readingCache.result = {
      field: field,
      phi: phi,
      phiA: phiA,
      phiB: phiB,
      uAB: uAB,
      deltaPhi: deltaPhi,
      energy: energy,
      work: work,
      pathIntegral: pathIntegral,
      pathValid: Number.isFinite(pathIntegral),
      distances: distances
    };
    return readingCache.result;
  }

  function buildPhysicsPath() {
    var a = metersPointToCm(state.points.A);
    var b = metersPointToCm(state.points.B);
    if (state.pathType === "polyline") {
      var polylinePoints = [a].concat(state.pathPoints.map(metersPointToCm), [b]);
      return Core.createPolylinePath(polylinePoints);
    }
    if (state.pathType === "arc") {
      var control = state.pathPoints[0] || {
        x: (state.points.A.x + state.points.B.x) / 2,
        y: (state.points.A.y + state.points.B.y) / 2 + 0.12
      };
      var sampled = [];
      for (var index = 0; index <= 48; index += 1) {
        var t = index / 48;
        var oneMinus = 1 - t;
        sampled.push({
          x: (oneMinus * oneMinus * state.points.A.x + 2 * oneMinus * t * control.x + t * t * state.points.B.x) * 100,
          y: (oneMinus * oneMinus * state.points.A.y + 2 * oneMinus * t * control.y + t * t * state.points.B.y) * 100
        });
      }
      return Core.createPolylinePath(sampled);
    }
    return Core.createLinePath(a, b);
  }

  function directionLabel(angle) {
    if (!Number.isFinite(angle)) return "方向未定义";
    var labels = ["+x", "+x / +y", "+y", "−x / +y", "−x", "−x / −y", "−y", "+x / −y"];
    return labels[Math.round(angle / 45) % 8];
  }

  function updateReadings() {
    var result = getReadings();
    var field = result.field;
    var singular = field.singular || !Number.isFinite(result.phi);
    var angle = !singular && field.magnitude > 1e-12
      ? (Math.atan2(field.ey, field.ex) * 180 / Math.PI + 360) % 360
      : NaN;
    var forceX = !singular ? Core.nCToC(state.probe.q) * field.ex : NaN;
    var forceY = !singular ? Core.nCToC(state.probe.q) * field.ey : NaN;

    dom.probePosition.textContent = "( " + signed(state.probe.x * 100, 1) + ", " + signed(state.probe.y * 100, 1) + " ) cm";
    dom.fieldDirection.textContent = Number.isFinite(angle) ? angle.toFixed(1) + "° · " + directionLabel(angle) : "方向未定义";
    dom.fieldStrength.textContent = singular ? "未定义（奇点）" : formatAdaptive(field.magnitude, "N/C");
    dom.potential.textContent = Number.isFinite(result.phi) ? formatPotential(result.phi) : "未定义（奇点）";
    dom.potentialEnergy.textContent = Number.isFinite(result.energy) ? formatEnergy(result.energy) : "未定义";
    dom.work.textContent = Number.isFinite(result.work) ? formatEnergy(result.work) : "路径无效";
    dom.distance.textContent = result.distances.map(function (distance) { return distance.toFixed(1); }).join(" / ") + " cm";
    dom.fieldAngle.textContent = Number.isFinite(angle) ? angle.toFixed(1) + "°" : "—";

    if (singular) {
      dom.measurementSummary.textContent = "探针进入点电荷显示屏蔽区。理想点电荷中心的 E 与 φ 发散，数值未定义。";
    } else {
      var integralText = result.pathValid ? formatPotential(result.pathIntegral) : "路径穿越奇点";
      var error = result.pathValid && Number.isFinite(result.uAB)
        ? Math.abs(result.pathIntegral - result.uAB)
        : NaN;
      var forceText = "F = (" + formatAdaptive(forceX, "N") + ", " + formatAdaptive(forceY, "N") + ")";
      dom.measurementSummary.textContent = "UAB = φA − φB = " + formatPotential(result.uAB) +
        "；∫A→B E·dl = " + integralText +
        (Number.isFinite(error) ? "（差值 " + error.toExponential(1) + " V）" : "") +
        "；" + forceText + "。";
    }
  }

  function setPathType(type) {
    state.pathType = type;
    state.pathPoints = pathControlDefaults(type);
    readingCache.signature = null;
    syncRenderers(false);
    updateReadings();
    announce("测量路径已切换为" + ({ line: "直线", polyline: "折线", arc: "曲线" }[type] || type));
  }

  function addMeasurement() {
    var result = getReadings();
    measurements.push({
      label: "P" + (measurements.length + 1),
      xCm: state.probe.x * 100,
      yCm: state.probe.y * 100,
      potentialV: result.phi,
      fieldNC: result.field.magnitude,
      singular: result.field.singular || !Number.isFinite(result.phi)
    });
    if (measurements.length > 12) measurements.shift();
    renderMeasurementLog();
    announce("已记录当前探针读数");
  }

  function renderMeasurementLog() {
    dom.measurementLog.innerHTML = "";
    if (!measurements.length) {
      var emptyRow = document.createElement("tr");
      emptyRow.className = "empty-row";
      emptyRow.innerHTML = '<td colspan="3">尚未添加测量点</td>';
      dom.measurementLog.appendChild(emptyRow);
      return;
    }
    measurements.forEach(function (entry) {
      var row = document.createElement("tr");
      row.innerHTML = "<td>" + entry.label + " (" + signed(entry.xCm, 1) + ", " + signed(entry.yCm, 1) + ")</td>" +
        "<td>" + (entry.singular ? "未定义" : formatPotential(entry.potentialV)) + "</td>" +
        "<td>" + (entry.singular ? "未定义" : formatAdaptive(entry.fieldNC, "N/C")) + "</td>";
      dom.measurementLog.appendChild(row);
    });
  }

  function selectTab(name, focus) {
    all("[data-tab]").forEach(function (tab) {
      var active = tab.dataset.tab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    all("[data-panel]").forEach(function (panel) {
      var active = panel.dataset.panel === name;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  function onTabKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    var tabs = all("[data-tab]");
    var index = tabs.indexOf(event.currentTarget);
    if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") index = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = tabs.length - 1;
    event.preventDefault();
    selectTab(tabs[index].dataset.tab, true);
  }

  function onCanvasKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    var step = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "ArrowLeft") state.probe.x -= step;
    if (event.key === "ArrowRight") state.probe.x += step;
    if (event.key === "ArrowUp") state.probe.y += step;
    if (event.key === "ArrowDown") state.probe.y -= step;
    state.probe.x = clamp(state.probe.x, -0.39, 0.39);
    state.probe.y = clamp(state.probe.y, -0.23, 0.23);
    event.preventDefault();
    readingCache.signature = null;
    syncRenderers(false);
    updateReadings();
  }

  function markActivity(id) {
    if (!id) return;
    completedActivities.add(id);
    var item = byId("guided-" + id) || document.querySelector('[data-experiment-id="' + id + '"]');
    if (item) item.classList.add("is-complete");
    updateProgress();
  }

  function updateProgress() {
    var current = Math.min(6, 2 + completedActivities.size);
    dom.chapterProgress.value = current;
    dom.chapterProgress.textContent = current + " / 6";
    dom.chapterProgressText.innerHTML = String(current).padStart(2, "0") + ' <span aria-hidden="true">/</span> 06';
  }

  function onQuizSubmit(event) {
    event.preventDefault();
    var questions = all("[data-quiz-answer]");
    var score = 0;
    var unanswered = 0;
    questions.forEach(function (question) {
      var selected = question.querySelector("input:checked");
      var correct = selected && selected.value === question.dataset.quizAnswer;
      var feedback = question.querySelector(".quiz-feedback");
      question.classList.toggle("is-correct", Boolean(correct));
      question.classList.toggle("is-incorrect", Boolean(selected && !correct));
      feedback.classList.toggle("is-correct", Boolean(correct));
      feedback.classList.toggle("is-incorrect", Boolean(selected && !correct));
      if (!selected) {
        unanswered += 1;
        feedback.textContent = "请选择一个答案。";
      } else if (correct) {
        score += 1;
        feedback.textContent = "正确。" + QUIZ_EXPLANATIONS[question.dataset.question];
      } else {
        feedback.textContent = "需要修正。" + QUIZ_EXPLANATIONS[question.dataset.question];
      }
    });
    dom.quizScore.textContent = score + " / " + questions.length;
    dom.quizResult.textContent = unanswered
      ? "还有 " + unanswered + " 题未作答。"
      : score === questions.length ? "四个核心判断全部正确。" : "已给出逐题解释，请回看对应知识点。";
    if (!unanswered) markActivity("quiz");
  }

  function resetQuizFeedback() {
    setTimeout(function () {
      all(".quiz-item").forEach(function (item) {
        item.classList.remove("is-correct", "is-incorrect");
        var feedback = item.querySelector(".quiz-feedback");
        feedback.className = "quiz-feedback";
        feedback.textContent = "";
      });
      dom.quizScore.textContent = "— / 4";
      dom.quizResult.textContent = "";
    }, 0);
  }

  function openDialog(id) {
    var dialog = byId(id);
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportSnapshot(format) {
    var stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "png") {
      var renderer = currentView === "potential-surface" ? surfaceRenderer : fieldRenderer;
      var dataUrl = renderer.exportImage("image/png", 0.95);
      var link = document.createElement("a");
      link.href = dataUrl;
      link.download = "fieldlab-" + currentView + "-" + stamp + ".png";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      var result = getReadings();
      var payload = {
        title: "场域 FIELDLAB 静电场实验快照",
        exportedAt: new Date().toISOString(),
        model: "真空中有限个静止三维点电荷在 z=0 平面的截面",
        conventions: {
          coordinates: "state 中为 m，导出同时给出 cm",
          sourceCharge: "nC",
          field: "N/C",
          potential: "V",
          potentialDifference: "U_AB = phi_A - phi_B",
          work: "W_e(A->B) = q * U_AB"
        },
        preset: currentPreset,
        state: state,
        readings: result,
        measurements: measurements
      };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), "fieldlab-data-" + stamp + ".json");
    }
    closeDialog(byId("export-dialog"));
    announce(format === "png" ? "图像已导出" : "实验数据已导出");
  }

  function announce(message) {
    if (dom.liveRegion) dom.liveRegion.textContent = message;
  }

  function bindEvents() {
    all("[data-preset]").forEach(function (button) {
      button.addEventListener("click", function () { setPreset(button.dataset.preset); });
    });
    all("[data-view]").forEach(function (button) {
      button.addEventListener("click", function () { setView(button.dataset.view); });
    });
    [dom.q1Slider, dom.q2Slider, dom.testChargeSlider].forEach(function (slider) {
      slider.addEventListener("input", onSliderInput);
    });
    all("[data-layer]").forEach(function (input) {
      input.addEventListener("change", function () {
        state.layers[input.dataset.layer] = input.checked;
        syncRenderers(true);
      });
    });
    all("[data-path]").forEach(function (input) {
      input.addEventListener("change", function () {
        if (input.checked) setPathType(input.dataset.path);
      });
    });
    all("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () { selectTab(tab.dataset.tab); });
      tab.addEventListener("keydown", onTabKeydown);
    });
    all('[data-action="start-experiment"]').forEach(function (button) {
      button.addEventListener("click", function () {
        var article = button.closest("[data-load-preset]");
        setPreset(article.dataset.loadPreset, { complete: article.dataset.experimentId });
        document.getElementById("experiment").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    dom.resetExperiment.addEventListener("click", function () { setPreset(currentPreset); });
    dom.helpButton.addEventListener("click", function () { openDialog("help-dialog"); });
    dom.exportButton.addEventListener("click", function () { openDialog("export-dialog"); });
    byId("layers-default").addEventListener("click", function () {
      state.layers = clone(DEFAULT_LAYERS);
      if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) state.layers.animation = false;
      updateControls();
      syncRenderers(true);
    });
    byId("add-measurement-point").addEventListener("click", addMeasurement);
    byId("clear-measurement").addEventListener("click", function () {
      measurements = [];
      renderMeasurementLog();
      announce("测量记录已清空");
    });
    byId("principle-more").addEventListener("click", function () {
      byId("derivation-system").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    dom.quizForm.addEventListener("submit", onQuizSubmit);
    dom.quizForm.addEventListener("reset", resetQuizFeedback);
    dom.fieldCanvas.tabIndex = 0;
    dom.fieldCanvas.addEventListener("keydown", onCanvasKeydown);

    all("dialog [data-dialog-close]").forEach(function (button) {
      button.addEventListener("click", function () { closeDialog(button.closest("dialog")); });
    });
    all("dialog").forEach(function (dialog) {
      dialog.addEventListener("click", function (event) {
        if (event.target === dialog) closeDialog(dialog);
      });
    });
    all("[data-export-format]").forEach(function (button) {
      button.addEventListener("click", function () { exportSnapshot(button.dataset.exportFormat); });
    });
  }

  function cacheDom() {
    dom.fieldCanvas = byId("field-canvas");
    dom.surfaceCanvas = byId("surface-canvas");
    dom.canvasStage = byId("canvas-stage");
    dom.visualTitle = byId("visual-title");
    dom.canvasInstruction = byId("canvas-instruction");
    dom.visualCaption = byId("visual-caption");
    dom.renderState = byId("render-state");
    dom.q1Slider = byId("q1-slider");
    dom.q2Slider = byId("q2-slider");
    dom.testChargeSlider = byId("test-charge-slider");
    dom.probePosition = byId("probe-position-value");
    dom.fieldDirection = byId("field-direction-value");
    dom.fieldStrength = byId("field-strength-value");
    dom.potential = byId("potential-value");
    dom.potentialEnergy = byId("potential-energy-value");
    dom.work = byId("work-value");
    dom.distance = byId("distance-value");
    dom.fieldAngle = byId("field-angle-value");
    dom.measurementSummary = byId("measurement-summary");
    dom.measurementLog = byId("measurement-log");
    dom.resetExperiment = byId("reset-experiment");
    dom.helpButton = byId("help-button");
    dom.exportButton = byId("export-data");
    dom.quizForm = byId("quiz-form");
    dom.quizScore = byId("quiz-score");
    dom.quizResult = byId("quiz-result");
    dom.chapterProgress = byId("chapter-progress");
    dom.chapterProgressText = byId("chapter-progress-text");
    dom.liveRegion = byId("live-region");
  }

  function failGracefully(error) {
    console.error(error);
    var empty = byId("canvas-empty-state");
    if (empty) {
      empty.hidden = false;
      empty.querySelector("strong").textContent = "实验模块加载失败";
      empty.querySelector("span:last-child").textContent = error.message || String(error);
    }
    updateStatus("需要检查");
  }

  function init() {
    try {
      if (!Core || !FieldRenderer || !SurfaceRenderer) {
        throw new Error("物理核心或可视化模块未正确加载。");
      }
      cacheDom();
      state = createStateFromPreset(currentPreset);
      fieldRenderer = new FieldRenderer(dom.fieldCanvas, {
        state: state,
        visibleWidth: 0.8,
        onChange: onRendererChange
      });
      surfaceRenderer = new SurfaceRenderer(dom.surfaceCanvas, {
        getState: function () { return state; },
        visibleWidth: 0.8,
        centimetersPerWorldUnit: 100
      });
      bindEvents();
      updateControls();
      updatePresetButtons();
      updateViewButtons();
      renderMeasurementLog();
      updateReadings();
      setView(currentView);
      global.FieldLabApp = {
        getState: function () { return clone(state); },
        setPreset: setPreset,
        setView: setView,
        getReadings: getReadings,
        fieldRenderer: fieldRenderer,
        surfaceRenderer: surfaceRenderer
      };
    } catch (error) {
      failGracefully(error);
    }
  }

  init();
})(window);
