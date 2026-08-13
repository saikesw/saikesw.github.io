(function (global) {
  'use strict';

  var DEFAULT_LAYERS = {
    grid: true,
    ruler: true,
    potential: true,
    equipotentials: true,
    fieldVectors: true,
    fieldLines: true,
    particles: true,
    charges: true,
    probe: true,
    points: true,
    path: true,
    labels: true
  };

  var LAYER_ALIASES = {
    potential: ['heatmap', 'potentialHeatmap'],
    equipotentials: ['equipotential', 'contours', 'potentialLines'],
    fieldVectors: ['vectors', 'field', 'vectorField'],
    fieldLines: ['field-lines', 'lines', 'streamlines'],
    particles: ['animation', 'fieldParticles'],
    charges: ['sources'],
    points: ['abPoints'],
    ruler: ['scale']
  };

  var COLORS = {
    background: '#f5f7f6',
    ink: '#26323a',
    mutedInk: '#68747b',
    gridMinor: 'rgba(49, 68, 76, 0.075)',
    gridMajor: 'rgba(49, 68, 76, 0.16)',
    axis: 'rgba(49, 68, 76, 0.29)',
    positive: '#df6d63',
    positiveDark: '#a83f3b',
    neutral: '#f0f2ef',
    negative: '#168d9d',
    negativeDark: '#096473',
    vector: 'rgba(36, 67, 78, 0.62)',
    fieldLine: 'rgba(40, 77, 89, 0.48)',
    path: '#59646c',
    probe: '#d29c31',
    pointA: '#c6534e',
    pointB: '#147f8d'
  };

  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function mixRgb(a, b, t) {
    return [
      Math.round(lerp(a[0], b[0], t)),
      Math.round(lerp(a[1], b[1], t)),
      Math.round(lerp(a[2], b[2], t))
    ];
  }

  function quantile(sorted, fraction) {
    if (!sorted.length) return 0;
    var index = clamp(fraction, 0, 1) * (sorted.length - 1);
    var lower = Math.floor(index);
    var upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return lerp(sorted[lower], sorted[upper], index - lower);
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 0.1;
    var power = Math.pow(10, Math.floor(Math.log10(raw)));
    var fraction = raw / power;
    var niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return niceFraction * power;
  }

  function pointFrom(value, fallback) {
    if (!value) return fallback ? { x: fallback.x, y: fallback.y } : null;
    return {
      x: finite(value.x, fallback ? fallback.x : 0),
      y: finite(value.y, fallback ? fallback.y : 0)
    };
  }

  function safeSignature(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return null;
    }
  }

  function formatValue(value, unit) {
    var absolute = Math.abs(value);
    var scaled = value;
    var suffix = '';

    if (absolute >= 1e9) {
      scaled = value / 1e9;
      suffix = 'G';
    } else if (absolute >= 1e6) {
      scaled = value / 1e6;
      suffix = 'M';
    } else if (absolute >= 1e3) {
      scaled = value / 1e3;
      suffix = 'k';
    } else if (absolute > 0 && absolute < 1e-3) {
      scaled = value * 1e6;
      suffix = 'u';
    } else if (absolute > 0 && absolute < 1) {
      scaled = value * 1e3;
      suffix = 'm';
    }

    var digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
    return scaled.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1') + ' ' + suffix + unit;
  }

  function formatDistance(meters) {
    if (meters < 0.01) return Math.round(meters * 1000) + ' mm';
    if (meters < 1) return Number((meters * 100).toPrecision(3)) + ' cm';
    return Number(meters.toPrecision(3)) + ' m';
  }

  function normalizeState(input, visibleWidth) {
    input = input || {};
    var rawCharges = Array.isArray(input.charges) ? input.charges : [];
    var points = input.points || {};
    var normalizedPoints = {
      A: pointFrom(points.A || points.a, { x: -0.2, y: 0.12 }),
      B: pointFrom(points.B || points.b, { x: 0.2, y: -0.12 })
    };
    var rawPath = input.path || {};
    var rawPathPoints = input.pathPoints || rawPath.controlPoints || rawPath.points || [];
    var pathType = String(input.pathType || rawPath.type || 'straight').toLowerCase();
    var pathPoints = Array.isArray(rawPathPoints) ? rawPathPoints.map(function (point, index) {
      var normalized = pointFrom(point, { x: 0, y: 0 });
      normalized.id = point.id == null ? index : point.id;
      return normalized;
    }) : [];
    var view = input.view || {};
    var suppliedBounds = input.worldBounds || view.bounds || view;
    var minX = finite(suppliedBounds.xMin, finite(suppliedBounds.minX, NaN));
    var maxX = finite(suppliedBounds.xMax, finite(suppliedBounds.maxX, NaN));
    var minY = finite(suppliedBounds.yMin, finite(suppliedBounds.minY, NaN));
    var maxY = finite(suppliedBounds.yMax, finite(suppliedBounds.maxY, NaN));
    var hasBounds = minX < maxX && minY < maxY;
    var center = view.center || {};
    var normalizedView = hasBounds ? {
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      width: clamp(maxX - minX, 0.02, 100),
      height: clamp(maxY - minY, 0.02, 100),
      explicitBounds: true
    } : {
      centerX: finite(view.centerX, finite(center.x, 0)),
      centerY: finite(view.centerY, finite(center.y, 0)),
      width: clamp(finite(view.width, finite(view.visibleWidth, visibleWidth)), 0.02, 100),
      height: clamp(finite(view.height, finite(view.visibleHeight, NaN)), 0.02, 100),
      explicitBounds: false
    };

    if (!Number.isFinite(normalizedView.height)) normalizedView.height = null;

    if (!pathPoints.length && (pathType === 'polyline' || pathType === 'broken')) {
      var dx = normalizedPoints.B.x - normalizedPoints.A.x;
      var dy = normalizedPoints.B.y - normalizedPoints.A.y;
      var distance = Math.hypot(dx, dy) || 1;
      var bend = Math.min(visibleWidth * 0.1, distance * 0.22);
      pathPoints.push({
        id: 'bend',
        x: (normalizedPoints.A.x + normalizedPoints.B.x) / 2 - dy / distance * bend,
        y: (normalizedPoints.A.y + normalizedPoints.B.y) / 2 + dx / distance * bend
      });
    }

    var units = input.units || {};
    return {
      charges: rawCharges.map(function (charge, index) {
        return {
          id: charge.id == null ? String(index) : charge.id,
          x: finite(charge.x, 0),
          y: finite(charge.y, 0),
          q: finite(charge.q, 0),
          qC: Number.isFinite(charge.qC) ? charge.qC : null,
          locked: Boolean(charge.locked),
          label: charge.label
        };
      }),
      probe: input.probe === null ? null : Object.assign({}, input.probe || {}, {
        x: finite(input.probe && input.probe.x, 0.16),
        y: finite(input.probe && input.probe.y, -0.08),
        q: finite(input.probe && input.probe.q, 1)
      }),
      points: normalizedPoints,
      pathType: pathType,
      pathPoints: pathPoints,
      layers: Object.assign({}, input.layers || {}),
      view: normalizedView,
      chargeUnit: String(input.chargeUnit || units.charge || '').toLowerCase(),
      showProbeReadout: Boolean(input.showProbeReadout),
      raw: input
    };
  }

  function FieldRenderer(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('FieldRenderer requires a canvas element.');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('A 2D canvas context is required.');

    this.options = options || {};
    this.core = this.options.core || global.PhysicsCore;
    if (!this.core || typeof this.core.fieldAt !== 'function' || typeof this.core.potentialAt !== 'function') {
      throw new Error('FieldRenderer requires window.PhysicsCore.fieldAt and potentialAt.');
    }

    this.visibleWidth = clamp(finite(this.options.visibleWidth, 0.8), 0.02, 100);
    this.state = normalizeState({}, this.visibleWidth);
    this._sourceSignature = null;
    this._cache = this._emptyCache();
    this._dirtyQuality = 'full';
    this._sourceChargesCm = [];
    this._drag = null;
    this._hover = null;
    this._destroyed = false;
    this._raf = null;
    this._lastTime = 0;
    this._cssWidth = 1;
    this._cssHeight = 1;
    this._dpr = 1;
    this._lineOccupancy = new Map();
    this._originalTouchAction = canvas.style.touchAction;
    this._originalCursor = canvas.style.cursor;

    this._onPointerDownBound = this._onPointerDown.bind(this);
    this._onPointerMoveBound = this._onPointerMove.bind(this);
    this._onPointerUpBound = this._onPointerUp.bind(this);
    this._onPointerLeaveBound = this._onPointerLeave.bind(this);
    this._onWindowResizeBound = this.resize.bind(this);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this._onPointerDownBound);
    canvas.addEventListener('pointermove', this._onPointerMoveBound, { passive: false });
    canvas.addEventListener('pointerup', this._onPointerUpBound);
    canvas.addEventListener('pointercancel', this._onPointerUpBound);
    canvas.addEventListener('pointerleave', this._onPointerLeaveBound);

    if (typeof global.ResizeObserver === 'function') {
      this._resizeObserver = new global.ResizeObserver(this._onWindowResizeBound);
      this._resizeObserver.observe(canvas);
    } else {
      this._resizeObserver = null;
      global.addEventListener('resize', this._onWindowResizeBound);
    }

    var initialState = this.options.state;
    if (!initialState && typeof this.options.getState === 'function') {
      initialState = this.options.getState();
    }
    this.setState(initialState || {});
    this.resize();
    if (this.options.autoStart !== false) this.render();
  }

  FieldRenderer.prototype._emptyCache = function () {
    return {
      quality: null,
      scalar: null,
      contours: [],
      vectors: [],
      fieldLines: [],
      fieldReference: 1,
      potentialClip: 1,
      clippedFraction: 0
    };
  };

  FieldRenderer.prototype._layer = function (name) {
    var layers = this.state.layers || {};
    if (layers.all === false && layers[name] === undefined) return false;
    if (layers[name] !== undefined) return Boolean(layers[name]);

    var aliases = LAYER_ALIASES[name] || [];
    for (var index = 0; index < aliases.length; index += 1) {
      if (layers[aliases[index]] !== undefined) return Boolean(layers[aliases[index]]);
    }
    return DEFAULT_LAYERS[name] !== false;
  };

  FieldRenderer.prototype._cacheSignature = function () {
    return safeSignature({
      charges: this.state.charges.map(function (charge) {
        return [charge.id, charge.x, charge.y, charge.q, charge.qC];
      }),
      view: this.state.view,
      size: [this._cssWidth, this._cssHeight],
      chargeUnit: this.state.chargeUnit,
      layers: {
        potential: this._layer('potential'),
        contours: this._layer('equipotentials'),
        vectors: this._layer('fieldVectors'),
        lines: this._layer('fieldLines'),
        particles: this._layer('particles')
      }
    });
  };

  FieldRenderer.prototype.setState = function (state) {
    if (this._destroyed) return this;
    var previousCacheSignature = this._cacheSignature();
    this.state = normalizeState(state || {}, this.visibleWidth);
    this._sourceSignature = safeSignature(state || {});

    if (previousCacheSignature !== this._cacheSignature()) {
      this.invalidate({ full: !this._drag });
    } else {
      this._requestFrame();
    }
    return this;
  };

  FieldRenderer.prototype.invalidate = function (request) {
    if (this._destroyed) return this;
    var full = typeof request === 'boolean' ? request : !request || request.full !== false;
    this._dirtyQuality = full ? 'full' : 'preview';
    this._requestFrame();
    return this;
  };

  FieldRenderer.prototype.resize = function (width, height) {
    if (this._destroyed) return false;
    var rect = this.canvas.getBoundingClientRect();
    var parent = this.canvas.parentElement;
    var nextWidth = finite(width, rect.width || (parent && parent.clientWidth) || 800);
    var nextHeight = finite(height, rect.height || (parent && parent.clientHeight) || 500);
    nextWidth = Math.max(1, Math.round(nextWidth));
    nextHeight = Math.max(1, Math.round(nextHeight));

    var requestedRatio = typeof this.options.pixelRatio === 'function'
      ? this.options.pixelRatio()
      : this.options.pixelRatio;
    var nextDpr = clamp(finite(requestedRatio, global.devicePixelRatio || 1), 1, 3);
    var backingWidth = Math.max(1, Math.round(nextWidth * nextDpr));
    var backingHeight = Math.max(1, Math.round(nextHeight * nextDpr));
    var changed = backingWidth !== this.canvas.width ||
      backingHeight !== this.canvas.height ||
      nextWidth !== this._cssWidth ||
      nextHeight !== this._cssHeight;

    if (!changed) return false;
    this._cssWidth = nextWidth;
    this._cssHeight = nextHeight;
    this._dpr = nextDpr;
    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;
    if (width != null) this.canvas.style.width = nextWidth + 'px';
    if (height != null) this.canvas.style.height = nextHeight + 'px';
    this.ctx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
    this.invalidate({ full: true });
    return true;
  };

  FieldRenderer.prototype._pullState = function () {
    if (this._drag || typeof this.options.getState !== 'function') return;
    var externalState = this.options.getState();
    if (!externalState) return;
    var signature = safeSignature(externalState);
    if (signature === null || signature !== this._sourceSignature) this.setState(externalState);
  };

  FieldRenderer.prototype._viewBounds = function () {
    var width = this.state.view.width;
    var height = this.state.view.height || width * this._cssHeight / this._cssWidth;
    var canvasAspect = this._cssWidth / Math.max(1, this._cssHeight);
    var viewAspect = width / height;

    // Preserve meter-to-pixel scale in both axes, expanding the supplied bounds when needed.
    if (viewAspect > canvasAspect) height = width / canvasAspect;
    else width = height * canvasAspect;

    return {
      minX: this.state.view.centerX - width / 2,
      maxX: this.state.view.centerX + width / 2,
      minY: this.state.view.centerY - height / 2,
      maxY: this.state.view.centerY + height / 2,
      width: width,
      height: height,
      scale: this._cssWidth / width
    };
  };

  FieldRenderer.prototype.getViewBounds = function () {
    return Object.assign({}, this._viewBounds());
  };

  FieldRenderer.prototype.worldToScreen = function (point) {
    var bounds = this._viewBounds();
    return {
      x: (point.x - bounds.minX) * bounds.scale,
      y: (bounds.maxY - point.y) * bounds.scale
    };
  };

  FieldRenderer.prototype.screenToWorld = function (point) {
    var bounds = this._viewBounds();
    return {
      x: bounds.minX + point.x / bounds.scale,
      y: bounds.maxY - point.y / bounds.scale
    };
  };

  FieldRenderer.prototype._eventScreenPoint = function (event) {
    var rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * this._cssWidth / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * this._cssHeight / Math.max(1, rect.height)
    };
  };

  FieldRenderer.prototype._requestFrame = function () {
    if (this._destroyed || this._raf !== null || typeof global.requestAnimationFrame !== 'function') return;
    var renderer = this;
    this._raf = global.requestAnimationFrame(function (time) {
      renderer._raf = null;
      renderer.render(time);
    });
  };

  FieldRenderer.prototype.render = function (time) {
    if (this._destroyed) return this;
    this._pullState();
    this._lastTime = finite(time, this._lastTime || (global.performance ? global.performance.now() : Date.now()));

    if (this._dirtyQuality) {
      this._rebuildCaches(this._dirtyQuality);
      this._dirtyQuality = null;
    }

    var context = this.ctx;
    context.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    context.clearRect(0, 0, this._cssWidth, this._cssHeight);
    context.fillStyle = this.options.background || COLORS.background;
    context.fillRect(0, 0, this._cssWidth, this._cssHeight);

    if (this._layer('potential')) this._drawPotential(context);
    if (this._layer('grid')) this._drawGrid(context);
    if (this._layer('equipotentials')) this._drawContours(context);
    if (this._layer('fieldLines')) this._drawFieldLines(context);
    if (this._layer('fieldVectors')) this._drawVectors(context);
    if (this._layer('path')) this._drawPath(context);
    if (this._layer('particles')) this._drawParticles(context, this._lastTime);
    if (this._layer('charges')) this._drawCharges(context);
    if (this._layer('probe')) this._drawProbe(context);
    if (this._layer('points')) this._drawPoints(context);
    this._drawInteraction(context);
    if (this._layer('ruler')) this._drawRuler(context);
    if (this._layer('potential')) this._drawPotentialLegend(context);

    if (this._shouldAnimate()) this._requestFrame();
    return this;
  };

  FieldRenderer.prototype._shouldAnimate = function () {
    return !this._drag && this._layer('particles') && this._cache.fieldLines.length > 0;
  };

  FieldRenderer.prototype._chargeScaleToNC = function () {
    var unit = this.state.chargeUnit;
    if (unit === 'c' || unit === 'coulomb' || unit === 'coulombs') return 1e9;
    return 1;
  };

  FieldRenderer.prototype._chargeValueNC = function (charge) {
    if (charge && Number.isFinite(charge.qC)) return charge.qC * 1e9;
    return charge ? charge.q * this._chargeScaleToNC() : 0;
  };

  FieldRenderer.prototype._prepareSources = function () {
    // The probe is intentionally excluded: only state.charges contributes to the source field.
    var renderer = this;
    this._sourceChargesCm = this.state.charges.map(function (charge) {
      return { x: charge.x * 100, y: charge.y * 100, q: renderer._chargeValueNC(charge) };
    });
  };

  FieldRenderer.prototype._singularityRadius = function () {
    var bounds = this._viewBounds();
    return Math.max(0.004, 6 / bounds.scale);
  };

  FieldRenderer.prototype._fieldAt = function (x, y) {
    var result;
    try {
      result = this.core.fieldAt(
        { x: x * 100, y: y * 100 },
        this._sourceChargesCm,
        this._singularityRadius() * 100
      );
    } catch (error) {
      return null;
    }

    if (!result) return null;
    var ex = finite(result.ex, finite(result.x, NaN));
    var ey = finite(result.ey, finite(result.y, NaN));
    var magnitude = finite(result.magnitude, Math.hypot(ex, ey));
    if (!Number.isFinite(ex) || !Number.isFinite(ey) || !Number.isFinite(magnitude)) return null;
    return { ex: ex, ey: ey, magnitude: magnitude, singular: Boolean(result.singular) };
  };

  FieldRenderer.prototype._potentialAt = function (x, y) {
    try {
      var result = this.core.potentialAt(
        { x: x * 100, y: y * 100 },
        this._sourceChargesCm,
        this._singularityRadius() * 100
      );
      var value = typeof result === 'number' ? result : result && result.potential;
      return typeof value === 'number' && !Number.isNaN(value) ? value : NaN;
    } catch (error) {
      return NaN;
    }
  };

  FieldRenderer.prototype._rebuildCaches = function (quality) {
    this._prepareSources();
    var cache = this._emptyCache();
    cache.quality = quality;

    if (this._layer('potential') || this._layer('equipotentials')) {
      cache.scalar = this._buildScalarGrid(quality);
      cache.potentialClip = cache.scalar.clip;
      cache.clippedFraction = cache.scalar.clippedFraction;
    }

    if (this._layer('fieldVectors')) {
      var vectorData = this._buildVectorGrid(quality);
      cache.vectors = vectorData.vectors;
      cache.fieldReference = vectorData.reference;
    } else if (this._layer('fieldLines') || this._layer('particles')) {
      cache.fieldReference = this._estimateFieldReference();
    }

    if (this._layer('equipotentials') && cache.scalar) {
      cache.contours = this._buildContours(cache.scalar);
    }

    this._cache = cache;
    if (this._layer('fieldLines') || this._layer('particles')) {
      cache.fieldLines = this._buildFieldLines(quality, cache.fieldReference);
    }
  };

  FieldRenderer.prototype._buildScalarGrid = function (quality) {
    var bounds = this._viewBounds();
    var preview = quality === 'preview';
    var columns = preview
      ? clamp(Math.round(this._cssWidth / 14), 42, 72)
      : clamp(Math.round(this._cssWidth / 7), 96, 170);
    var rows = clamp(Math.round(columns * this._cssHeight / this._cssWidth), 30, preview ? 70 : 130);
    var values = new Float64Array(columns * rows);
    var absoluteValues = [];
    var maxAbsolute = 0;

    for (var row = 0; row < rows; row += 1) {
      var y = lerp(bounds.maxY, bounds.minY, row / Math.max(1, rows - 1));
      for (var column = 0; column < columns; column += 1) {
        var x = lerp(bounds.minX, bounds.maxX, column / Math.max(1, columns - 1));
        var value = this._potentialAt(x, y);
        var index = row * columns + column;
        values[index] = value;
        if (Number.isFinite(value)) {
          var absolute = Math.abs(value);
          absoluteValues.push(absolute);
          maxAbsolute = Math.max(maxAbsolute, absolute);
        }
      }
    }

    absoluteValues.sort(function (a, b) { return a - b; });
    var clip = quantile(absoluteValues, 0.92);
    if (!(clip > 1e-12)) clip = maxAbsolute > 1e-12 ? maxAbsolute : 1;
    var clipped = 0;
    var offscreen = this.canvas.ownerDocument.createElement('canvas');
    offscreen.width = columns;
    offscreen.height = rows;
    var offscreenContext = offscreen.getContext('2d');
    var image = offscreenContext.createImageData(columns, rows);
    var coral = [223, 109, 99];
    var neutral = [240, 242, 239];
    var cyan = [22, 141, 157];
    var denominator = Math.asinh(1 / 0.16);

    for (var pixel = 0; pixel < values.length; pixel += 1) {
      var potential = values[pixel];
      var normalized = 0;
      if (Number.isFinite(potential)) {
        if (Math.abs(potential) >= clip) clipped += 1;
        normalized = clamp(Math.asinh(potential / (clip * 0.16)) / denominator, -1, 1);
      } else if (potential === Infinity || potential === -Infinity) {
        clipped += 1;
        normalized = potential > 0 ? 1 : -1;
      }
      var color = normalized < 0
        ? mixRgb(neutral, cyan, -normalized)
        : mixRgb(neutral, coral, normalized);
      image.data[pixel * 4] = color[0];
      image.data[pixel * 4 + 1] = color[1];
      image.data[pixel * 4 + 2] = color[2];
      image.data[pixel * 4 + 3] = Number.isNaN(potential) ? 255 : 232;
    }
    offscreenContext.putImageData(image, 0, 0);

    return {
      columns: columns,
      rows: rows,
      values: values,
      bounds: bounds,
      canvas: offscreen,
      clip: clip,
      maxAbsolute: maxAbsolute,
      clippedFraction: values.length ? clipped / values.length : 0
    };
  };

  FieldRenderer.prototype._buildVectorGrid = function (quality) {
    var bounds = this._viewBounds();
    var spacing = quality === 'preview' ? 82 : 58;
    var columns = Math.max(4, Math.floor(this._cssWidth / spacing));
    var rows = Math.max(3, Math.floor(this._cssHeight / spacing));
    var vectors = [];
    var magnitudes = [];

    for (var row = 0; row < rows; row += 1) {
      var y = lerp(bounds.maxY, bounds.minY, (row + 0.5) / rows);
      for (var column = 0; column < columns; column += 1) {
        var x = lerp(bounds.minX, bounds.maxX, (column + 0.5) / columns);
        var field = this._fieldAt(x, y);
        if (!field || field.singular || !(field.magnitude > 0)) continue;
        vectors.push({ x: x, y: y, ex: field.ex, ey: field.ey, magnitude: field.magnitude });
        magnitudes.push(field.magnitude);
      }
    }

    magnitudes.sort(function (a, b) { return a - b; });
    return {
      vectors: vectors,
      reference: Math.max(quantile(magnitudes, 0.82), 1e-12)
    };
  };

  FieldRenderer.prototype._estimateFieldReference = function () {
    var bounds = this._viewBounds();
    var magnitudes = [];
    for (var row = 0; row < 5; row += 1) {
      for (var column = 0; column < 7; column += 1) {
        var field = this._fieldAt(
          lerp(bounds.minX, bounds.maxX, (column + 0.5) / 7),
          lerp(bounds.minY, bounds.maxY, (row + 0.5) / 5)
        );
        if (field && !field.singular && field.magnitude > 0) magnitudes.push(field.magnitude);
      }
    }
    magnitudes.sort(function (a, b) { return a - b; });
    return Math.max(quantile(magnitudes, 0.75), 1e-12);
  };

  FieldRenderer.prototype._buildContours = function (scalar) {
    if (!(scalar.maxAbsolute > 1e-12)) return [];
    var ratios = [-0.8, -0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5, 0.8];
    var contours = [];
    for (var index = 0; index < ratios.length; index += 1) {
      var level = ratios[index] * scalar.clip;
      contours.push({ level: level, segments: this._marchingSquares(scalar, level, index) });
    }
    return contours;
  };

  FieldRenderer.prototype._marchingSquares = function (scalar, level, levelIndex) {
    var columns = scalar.columns;
    var rows = scalar.rows;
    var values = scalar.values;
    var bounds = scalar.bounds;
    var segments = [];
    var epsilon = Math.max(1e-12, scalar.clip * 1e-11);

    function stableOffset(value, column, row, corner) {
      var delta = value - level;
      if (Math.abs(delta) > epsilon) return delta;
      var hash = ((column * 73856093) ^ (row * 19349663) ^ (corner * 83492791) ^ levelIndex) >>> 0;
      return (hash & 1 ? 1 : -1) * epsilon;
    }

    function edgePoint(edge, f, points) {
      var first;
      var second;
      if (edge === 0) { first = 0; second = 1; }
      else if (edge === 1) { first = 1; second = 2; }
      else if (edge === 2) { first = 3; second = 2; }
      else { first = 0; second = 3; }
      var denominator = f[first] - f[second];
      var t = Math.abs(denominator) < epsilon ? 0.5 : clamp(f[first] / denominator, 0, 1);
      return {
        x: lerp(points[first].x, points[second].x, t),
        y: lerp(points[first].y, points[second].y, t)
      };
    }

    function addPair(edgeA, edgeB, f, points) {
      segments.push([edgePoint(edgeA, f, points), edgePoint(edgeB, f, points)]);
    }

    for (var row = 0; row < rows - 1; row += 1) {
      var yTop = lerp(bounds.maxY, bounds.minY, row / (rows - 1));
      var yBottom = lerp(bounds.maxY, bounds.minY, (row + 1) / (rows - 1));
      for (var column = 0; column < columns - 1; column += 1) {
        var xLeft = lerp(bounds.minX, bounds.maxX, column / (columns - 1));
        var xRight = lerp(bounds.minX, bounds.maxX, (column + 1) / (columns - 1));
        var raw = [
          values[row * columns + column],
          values[row * columns + column + 1],
          values[(row + 1) * columns + column + 1],
          values[(row + 1) * columns + column]
        ];
        if (!raw.every(Number.isFinite)) continue;

        var f = [
          stableOffset(raw[0], column, row, 0),
          stableOffset(raw[1], column, row, 1),
          stableOffset(raw[2], column, row, 2),
          stableOffset(raw[3], column, row, 3)
        ];
        var mask = (f[0] > 0 ? 1 : 0) |
          (f[1] > 0 ? 2 : 0) |
          (f[2] > 0 ? 4 : 0) |
          (f[3] > 0 ? 8 : 0);
        if (mask === 0 || mask === 15) continue;

        var points = [
          { x: xLeft, y: yTop },
          { x: xRight, y: yTop },
          { x: xRight, y: yBottom },
          { x: xLeft, y: yBottom }
        ];

        if (mask === 1 || mask === 14) addPair(3, 0, f, points);
        else if (mask === 2 || mask === 13) addPair(0, 1, f, points);
        else if (mask === 3 || mask === 12) addPair(3, 1, f, points);
        else if (mask === 4 || mask === 11) addPair(1, 2, f, points);
        else if (mask === 6 || mask === 9) addPair(0, 2, f, points);
        else if (mask === 7 || mask === 8) addPair(3, 2, f, points);
        else {
          // Q is the bilinear asymptotic decider. The hash only resolves an exact saddle tie.
          var q = f[0] * f[2] - f[1] * f[3];
          if (Math.abs(q) <= epsilon * epsilon) {
            q = ((column * 31 + row * 17 + levelIndex) & 1) ? epsilon : -epsilon;
          }
          if (mask === 5) {
            if (q > 0) {
              addPair(0, 1, f, points);
              addPair(2, 3, f, points);
            } else {
              addPair(3, 0, f, points);
              addPair(1, 2, f, points);
            }
          } else if (q < 0) {
            addPair(3, 0, f, points);
            addPair(1, 2, f, points);
          } else {
            addPair(0, 1, f, points);
            addPair(2, 3, f, points);
          }
        }
      }
    }
    return segments;
  };

  FieldRenderer.prototype._nearestChargeDistance = function (x, y) {
    var nearest = Infinity;
    for (var index = 0; index < this.state.charges.length; index += 1) {
      var charge = this.state.charges[index];
      if (this._chargeValueNC(charge) === 0) continue;
      nearest = Math.min(nearest, Math.hypot(x - charge.x, y - charge.y));
    }
    return nearest;
  };

  FieldRenderer.prototype._normalizedDirection = function (x, y, sign, zeroThreshold) {
    var field = this._fieldAt(x, y);
    if (!field || field.singular || !(field.magnitude > zeroThreshold)) return null;
    return {
      x: sign * field.ex / field.magnitude,
      y: sign * field.ey / field.magnitude,
      magnitude: field.magnitude
    };
  };

  FieldRenderer.prototype._rk4Step = function (point, step, sign, zeroThreshold) {
    var k1 = this._normalizedDirection(point.x, point.y, sign, zeroThreshold);
    if (!k1) return null;
    var k2 = this._normalizedDirection(
      point.x + k1.x * step * 0.5,
      point.y + k1.y * step * 0.5,
      sign,
      zeroThreshold
    );
    if (!k2) return null;
    var k3 = this._normalizedDirection(
      point.x + k2.x * step * 0.5,
      point.y + k2.y * step * 0.5,
      sign,
      zeroThreshold
    );
    if (!k3) return null;
    var k4 = this._normalizedDirection(point.x + k3.x * step, point.y + k3.y * step, sign, zeroThreshold);
    if (!k4) return null;
    return {
      x: point.x + step * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
      y: point.y + step * (k1.y + 2 * k2.y + 2 * k3.y + k4.y) / 6
    };
  };

  FieldRenderer.prototype._traceFieldLine = function (seed, sign, quality, reference) {
    var bounds = this._viewBounds();
    var preview = quality === 'preview';
    var maximumSteps = preview ? 240 : 760;
    var baseStep = bounds.width / (preview ? 280 : 560);
    var hitRadius = Math.max(0.0075, 7 / bounds.scale);
    var zeroThreshold = Math.max(1e-12, reference * 1e-6);
    var cellSize = Math.max(bounds.width / 180, 7 / bounds.scale);
    var localCells = new Map();
    var points = [{ x: seed.x, y: seed.y }];
    var current = points[0];
    var lastCell = null;
    var length = 0;
    var maximumLength = Math.hypot(bounds.width, bounds.height) * 2.5;

    for (var stepIndex = 0; stepIndex < maximumSteps; stepIndex += 1) {
      var nearest = this._nearestChargeDistance(current.x, current.y);
      var adaptiveStep = Number.isFinite(nearest)
        ? clamp(nearest * 0.09, baseStep * 0.38, baseStep * 2.2)
        : baseStep * 1.5;
      var next = this._rk4Step(current, adaptiveStep, sign, zeroThreshold);
      if (!next) break;
      if (next.x < bounds.minX || next.x > bounds.maxX || next.y < bounds.minY || next.y > bounds.maxY) break;

      var segmentLength = Math.hypot(next.x - current.x, next.y - current.y);
      if (!(segmentLength > 1e-10)) break;
      length += segmentLength;
      points.push(next);
      current = next;

      if (stepIndex > 4 && this._nearestChargeDistance(current.x, current.y) < hitRadius) break;
      if (length > maximumLength) break;

      var cellX = Math.floor((current.x - bounds.minX) / cellSize);
      var cellY = Math.floor((current.y - bounds.minY) / cellSize);
      var cellKey = cellX + ':' + cellY;
      if (cellKey !== lastCell) {
        if (localCells.has(cellKey) && stepIndex - localCells.get(cellKey) > 10) break;
        if (stepIndex > 14 && this._lineOccupancy.has(cellKey)) break;
        localCells.set(cellKey, stepIndex);
        lastCell = cellKey;
      }
    }

    // Negative-source traces integrate against E to leave the seed, then reverse so arrows follow E inward.
    if (sign < 0) points.reverse();
    if (points.length < 8 || length * bounds.scale < 26) return null;
    return this._finalizeFieldLine(points);
  };

  FieldRenderer.prototype._finalizeFieldLine = function (points) {
    var cumulative = new Float64Array(points.length);
    var length = 0;
    for (var index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      cumulative[index] = length;
    }
    return { points: points, cumulative: cumulative, length: length };
  };

  FieldRenderer.prototype._occupyFieldLine = function (line, id) {
    var bounds = this._viewBounds();
    var cellSize = Math.max(bounds.width / 180, 7 / bounds.scale);
    for (var index = 3; index < line.points.length - 3; index += 4) {
      var point = line.points[index];
      var key = Math.floor((point.x - bounds.minX) / cellSize) + ':' +
        Math.floor((point.y - bounds.minY) / cellSize);
      if (!this._lineOccupancy.has(key)) this._lineOccupancy.set(key, id);
    }
  };

  FieldRenderer.prototype._boundarySeeds = function (quality) {
    var bounds = this._viewBounds();
    var count = quality === 'preview' ? 4 : 7;
    var inset = bounds.width / 500;
    var seeds = [];
    var renderer = this;

    function consider(x, y, inwardX, inwardY) {
      var field = renderer._fieldAt(x, y);
      if (!field || !(field.magnitude > 0)) return;
      var inwardComponent = (field.ex * inwardX + field.ey * inwardY) / field.magnitude;
      if (Math.abs(inwardComponent) < 0.16) return;
      seeds.push({ x: x, y: y, sign: inwardComponent > 0 ? 1 : -1 });
    }

    for (var index = 0; index < count; index += 1) {
      var t = (index + 0.5) / count;
      consider(bounds.minX + inset, lerp(bounds.minY, bounds.maxY, t), 1, 0);
      consider(bounds.maxX - inset, lerp(bounds.minY, bounds.maxY, t), -1, 0);
      consider(lerp(bounds.minX, bounds.maxX, t), bounds.maxY - inset, 0, -1);
      consider(lerp(bounds.minX, bounds.maxX, t), bounds.minY + inset, 0, 1);
    }
    return seeds;
  };

  FieldRenderer.prototype._buildFieldLines = function (quality, reference) {
    var bounds = this._viewBounds();
    var preview = quality === 'preview';
    var renderer = this;
    var nonzeroCharges = this.state.charges.filter(function (charge) {
      return renderer._chargeValueNC(charge) !== 0;
    });
    if (!nonzeroCharges.length) return [];

    var maximumCharge = nonzeroCharges.reduce(function (maximum, charge) {
      return Math.max(maximum, Math.abs(renderer._chargeValueNC(charge)));
    }, 0);
    var seedRadius = Math.max(0.011, 13 / bounds.scale);
    var seeds = [];

    nonzeroCharges.forEach(function (charge, chargeIndex) {
      var chargeNC = renderer._chargeValueNC(charge);
      var relative = maximumCharge > 0 ? Math.sqrt(Math.abs(chargeNC) / maximumCharge) : 0;
      var count = preview ? Math.round(4 + relative * 3) : Math.round(8 + relative * 8);
      for (var index = 0; index < count; index += 1) {
        var angle = Math.PI * 2 * (index / count + chargeIndex * 0.071);
        var x = charge.x + Math.cos(angle) * seedRadius;
        var y = charge.y + Math.sin(angle) * seedRadius;
        if (x > bounds.minX && x < bounds.maxX && y > bounds.minY && y < bounds.maxY) {
          seeds.push({ x: x, y: y, sign: chargeNC > 0 ? 1 : -1 });
        }
      }
    });

    seeds = seeds.concat(this._boundarySeeds(quality));
    var maximumLines = preview ? 34 : 92;
    var lines = [];
    this._lineOccupancy = new Map();

    for (var seedIndex = 0; seedIndex < seeds.length && lines.length < maximumLines; seedIndex += 1) {
      var seed = seeds[seedIndex];
      var line = this._traceFieldLine(seed, seed.sign, quality, reference);
      if (!line) continue;
      this._occupyFieldLine(line, lines.length);
      lines.push(line);
    }
    return lines;
  };

  FieldRenderer.prototype._drawPotential = function (context) {
    if (!this._cache.scalar || !this._cache.scalar.canvas) return;
    context.save();
    context.imageSmoothingEnabled = true;
    context.globalAlpha = 0.92;
    context.drawImage(this._cache.scalar.canvas, 0, 0, this._cssWidth, this._cssHeight);
    context.restore();
  };

  FieldRenderer.prototype._drawGrid = function (context) {
    var bounds = this._viewBounds();
    var major = niceStep(bounds.width / 8);
    var minor = major / 5;
    var startX = Math.ceil(bounds.minX / minor) * minor;
    var startY = Math.ceil(bounds.minY / minor) * minor;
    context.save();
    context.lineWidth = 1;

    for (var x = startX, xIndex = 0; x <= bounds.maxX + minor * 0.1; x += minor, xIndex += 1) {
      var screenX = this.worldToScreen({ x: x, y: 0 }).x;
      var isAxisX = Math.abs(x) < minor * 0.1;
      var isMajorX = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      context.strokeStyle = isAxisX ? COLORS.axis : isMajorX ? COLORS.gridMajor : COLORS.gridMinor;
      context.beginPath();
      context.moveTo(Math.round(screenX) + 0.5, 0);
      context.lineTo(Math.round(screenX) + 0.5, this._cssHeight);
      context.stroke();
    }

    for (var y = startY, yIndex = 0; y <= bounds.maxY + minor * 0.1; y += minor, yIndex += 1) {
      var screenY = this.worldToScreen({ x: 0, y: y }).y;
      var isAxisY = Math.abs(y) < minor * 0.1;
      var isMajorY = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      context.strokeStyle = isAxisY ? COLORS.axis : isMajorY ? COLORS.gridMajor : COLORS.gridMinor;
      context.beginPath();
      context.moveTo(0, Math.round(screenY) + 0.5);
      context.lineTo(this._cssWidth, Math.round(screenY) + 0.5);
      context.stroke();
    }
    context.restore();
  };

  FieldRenderer.prototype._drawContours = function (context) {
    if (!this._cache.contours.length) return;
    context.save();
    context.lineWidth = this._cache.quality === 'preview' ? 0.75 : 1.05;
    for (var contourIndex = 0; contourIndex < this._cache.contours.length; contourIndex += 1) {
      var contour = this._cache.contours[contourIndex];
      if (contour.level > 0) context.strokeStyle = 'rgba(160, 62, 58, 0.54)';
      else if (contour.level < 0) context.strokeStyle = 'rgba(4, 105, 120, 0.54)';
      else context.strokeStyle = 'rgba(42, 51, 56, 0.66)';
      context.setLineDash(contour.level === 0 ? [] : [3, 3]);
      context.beginPath();
      for (var segmentIndex = 0; segmentIndex < contour.segments.length; segmentIndex += 1) {
        var segment = contour.segments[segmentIndex];
        var first = this.worldToScreen(segment[0]);
        var second = this.worldToScreen(segment[1]);
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
      }
      context.stroke();
    }
    context.restore();
  };

  FieldRenderer.prototype._drawVectors = function (context) {
    var vectors = this._cache.vectors;
    if (!vectors.length) return;
    var reference = Math.max(this._cache.fieldReference, 1e-12);
    context.save();
    context.strokeStyle = COLORS.vector;
    context.fillStyle = COLORS.vector;
    context.lineWidth = 1.15;

    for (var index = 0; index < vectors.length; index += 1) {
      var vector = vectors[index];
      var center = this.worldToScreen(vector);
      var directionX = vector.ex / vector.magnitude;
      var directionY = -vector.ey / vector.magnitude;
      var strength = clamp(Math.log1p(vector.magnitude / reference) / Math.log(3), 0.2, 1.25);
      var length = 8 + strength * 13;
      var startX = center.x - directionX * length * 0.35;
      var startY = center.y - directionY * length * 0.35;
      var endX = center.x + directionX * length * 0.65;
      var endY = center.y + directionY * length * 0.65;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      this._drawArrowHead(context, endX, endY, directionX, directionY, 4.2);
    }
    context.restore();
  };

  FieldRenderer.prototype._drawArrowHead = function (context, x, y, directionX, directionY, size) {
    var normalX = -directionY;
    var normalY = directionX;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - directionX * size - normalX * size * 0.55, y - directionY * size - normalY * size * 0.55);
    context.lineTo(x - directionX * size + normalX * size * 0.55, y - directionY * size + normalY * size * 0.55);
    context.closePath();
    context.fill();
  };

  FieldRenderer.prototype._drawFieldLines = function (context) {
    var lines = this._cache.fieldLines;
    if (!lines.length) return;
    var bounds = this._viewBounds();
    var arrowSpacing = 78 / bounds.scale;
    context.save();
    context.strokeStyle = COLORS.fieldLine;
    context.fillStyle = 'rgba(33, 68, 80, 0.64)';
    context.lineWidth = this._cache.quality === 'preview' ? 0.8 : 1.25;

    for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      var line = lines[lineIndex];
      context.beginPath();
      for (var pointIndex = 0; pointIndex < line.points.length; pointIndex += 1) {
        var screen = this.worldToScreen(line.points[pointIndex]);
        if (pointIndex === 0) context.moveTo(screen.x, screen.y);
        else context.lineTo(screen.x, screen.y);
      }
      context.stroke();

      if (this._cache.quality === 'preview' || line.length < arrowSpacing * 0.55) continue;
      for (var distance = arrowSpacing * 0.55; distance < line.length; distance += arrowSpacing) {
        var sample = this._sampleLine(line, distance);
        if (!sample) continue;
        var marker = this.worldToScreen(sample.point);
        this._drawArrowHead(context, marker.x, marker.y, sample.tangent.x, -sample.tangent.y, 5.2);
      }
    }
    context.restore();
  };

  FieldRenderer.prototype._sampleLine = function (line, distance) {
    if (!line || line.points.length < 2 || !(line.length > 0)) return null;
    distance = clamp(distance, 0, line.length);
    var low = 0;
    var high = line.cumulative.length - 1;
    while (low < high) {
      var middle = Math.floor((low + high) / 2);
      if (line.cumulative[middle] < distance) low = middle + 1;
      else high = middle;
    }
    var endIndex = Math.max(1, low);
    var startIndex = endIndex - 1;
    var startDistance = line.cumulative[startIndex];
    var endDistance = line.cumulative[endIndex];
    var t = endDistance > startDistance ? (distance - startDistance) / (endDistance - startDistance) : 0;
    var start = line.points[startIndex];
    var end = line.points[endIndex];
    var dx = end.x - start.x;
    var dy = end.y - start.y;
    var magnitude = Math.hypot(dx, dy) || 1;
    return {
      point: { x: lerp(start.x, end.x, t), y: lerp(start.y, end.y, t) },
      tangent: { x: dx / magnitude, y: dy / magnitude }
    };
  };

  FieldRenderer.prototype._drawParticles = function (context, time) {
    var lines = this._cache.fieldLines;
    if (!lines.length || this._drag) return;
    var bounds = this._viewBounds();
    var speed = bounds.width * 0.035;
    var seconds = time / 1000;
    context.save();
    context.fillStyle = 'rgba(255, 255, 255, 0.94)';
    context.strokeStyle = 'rgba(27, 72, 84, 0.74)';
    context.lineWidth = 1;

    // These particles are direction markers only; they never enter the physical model.
    for (var index = 0; index < lines.length; index += 2) {
      var line = lines[index];
      if (!(line.length > 0)) continue;
      var distance = (seconds * speed + line.length * ((index * 0.317) % 1)) % line.length;
      var sample = this._sampleLine(line, distance);
      if (!sample) continue;
      var screen = this.worldToScreen(sample.point);
      context.beginPath();
      context.arc(screen.x, screen.y, 2.35, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
    context.restore();
  };

  FieldRenderer.prototype._pathControls = function () {
    return this.state.pathPoints || [];
  };

  FieldRenderer.prototype._drawPath = function (context) {
    var a = this.state.points.A;
    var b = this.state.points.B;
    if (!a || !b) return;
    var aScreen = this.worldToScreen(a);
    var bScreen = this.worldToScreen(b);
    var controls = this._pathControls();
    var type = this.state.pathType;
    context.save();
    context.strokeStyle = COLORS.path;
    context.lineWidth = 2;
    context.setLineDash([6, 5]);
    context.beginPath();
    context.moveTo(aScreen.x, aScreen.y);

    if (type === 'polyline' || type === 'broken' || type === '折线') {
      for (var index = 0; index < controls.length; index += 1) {
        var control = this.worldToScreen(controls[index]);
        context.lineTo(control.x, control.y);
      }
      context.lineTo(bScreen.x, bScreen.y);
    } else if (type === 'curve' || type === 'arc' || type === 'bezier' || type === '曲线') {
      if (controls.length >= 2) {
        var firstControl = this.worldToScreen(controls[0]);
        var secondControl = this.worldToScreen(controls[1]);
        context.bezierCurveTo(firstControl.x, firstControl.y, secondControl.x, secondControl.y, bScreen.x, bScreen.y);
      } else if (controls.length === 1) {
        var quadraticControl = this.worldToScreen(controls[0]);
        context.quadraticCurveTo(quadraticControl.x, quadraticControl.y, bScreen.x, bScreen.y);
      } else {
        var dx = bScreen.x - aScreen.x;
        var dy = bScreen.y - aScreen.y;
        var length = Math.hypot(dx, dy) || 1;
        var bend = Math.min(42, length * 0.18);
        context.quadraticCurveTo(
          (aScreen.x + bScreen.x) / 2 + dy / length * bend,
          (aScreen.y + bScreen.y) / 2 - dx / length * bend,
          bScreen.x,
          bScreen.y
        );
      }
    } else {
      context.lineTo(bScreen.x, bScreen.y);
    }
    context.stroke();

    if (controls.length) {
      context.setLineDash([]);
      context.fillStyle = 'rgba(255, 255, 255, 0.82)';
      context.strokeStyle = 'rgba(71, 82, 89, 0.62)';
      context.lineWidth = 1;
      for (var controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
        var controlScreen = this.worldToScreen(controls[controlIndex]);
        context.beginPath();
        context.rect(controlScreen.x - 3.5, controlScreen.y - 3.5, 7, 7);
        context.fill();
        context.stroke();
      }
    }
    context.restore();
  };

  FieldRenderer.prototype._chargeRadius = function (charge) {
    var magnitudeNC = Math.abs(this._chargeValueNC(charge));
    return clamp(10 + Math.log1p(magnitudeNC) * 2.1, 10, 18);
  };

  FieldRenderer.prototype._drawCharges = function (context) {
    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 12px system-ui, sans-serif';

    for (var index = 0; index < this.state.charges.length; index += 1) {
      var charge = this.state.charges[index];
      var center = this.worldToScreen(charge);
      var radius = this._chargeRadius(charge);
      var valueNC = this._chargeValueNC(charge);
      var positive = valueNC > 0;
      var negative = valueNC < 0;
      context.fillStyle = positive ? COLORS.positive : negative ? COLORS.negative : '#7b858a';
      context.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.fillStyle = '#ffffff';
      context.font = '700 ' + Math.round(radius * 1.15) + 'px system-ui, sans-serif';
      context.fillText(positive ? '+' : negative ? '-' : '0', center.x, center.y - 0.5);

      if (this._cssWidth >= 480 && this._layer('labels')) {
        context.font = '600 10px system-ui, sans-serif';
        context.fillStyle = positive ? COLORS.positiveDark : negative ? COLORS.negativeDark : COLORS.mutedInk;
        var label = charge.label || ((valueNC > 0 ? '+' : '') + Number(valueNC.toPrecision(3)) + ' nC');
        context.fillText(label, center.x, center.y + radius + 10);
      }
    }
    context.restore();
  };

  FieldRenderer.prototype._drawProbe = function (context) {
    var probe = this.state.probe;
    if (!probe || probe.visible === false) return;
    var center = this.worldToScreen(probe);
    context.save();
    context.translate(center.x, center.y);
    context.rotate(Math.PI / 4);
    context.fillStyle = 'rgba(255, 255, 255, 0.94)';
    context.strokeStyle = COLORS.probe;
    context.lineWidth = 2;
    context.fillRect(-6, -6, 12, 12);
    context.strokeRect(-6, -6, 12, 12);
    context.restore();

    context.save();
    context.fillStyle = '#73581f';
    context.font = '600 10px system-ui, sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'bottom';
    if (this._layer('labels')) context.fillText('q0', center.x + 9, center.y - 7);

    if (this.state.showProbeReadout && this._layer('labels')) {
      var field = this._fieldAt(probe.x, probe.y);
      var potential = this._potentialAt(probe.x, probe.y);
      var lines = [];
      if (field && !field.singular) lines.push('E ' + formatValue(field.magnitude, 'N/C'));
      if (Number.isFinite(potential)) lines.push('V ' + formatValue(potential, 'V'));
      context.textBaseline = 'top';
      context.fillStyle = COLORS.ink;
      for (var index = 0; index < lines.length; index += 1) {
        context.fillText(lines[index], center.x + 10, center.y + 5 + index * 12);
      }
    }
    context.restore();
  };

  FieldRenderer.prototype._drawPoints = function (context) {
    var entries = [
      { id: 'A', point: this.state.points.A, color: COLORS.pointA },
      { id: 'B', point: this.state.points.B, color: COLORS.pointB }
    ];
    context.save();
    context.font = '700 11px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      if (!entry.point) continue;
      var center = this.worldToScreen(entry.point);
      context.fillStyle = '#ffffff';
      context.strokeStyle = entry.color;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(center.x, center.y, 7.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = entry.color;
      context.fillText(entry.id, center.x, center.y + 0.5);
    }
    context.restore();
  };

  FieldRenderer.prototype._drawInteraction = function (context) {
    var target = this._drag || this._hover;
    if (!target) return;
    var point = this._targetPoint(target);
    if (!point) return;
    var screen = this.worldToScreen(point);
    context.save();
    context.strokeStyle = this._drag ? 'rgba(35, 45, 50, 0.75)' : 'rgba(35, 45, 50, 0.35)';
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.arc(screen.x, screen.y, 19, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  };

  FieldRenderer.prototype._drawRuler = function (context) {
    var bounds = this._viewBounds();
    var targetWorld = 105 / bounds.scale;
    var distance = niceStep(targetWorld);
    var pixelLength = distance * bounds.scale;
    var compact = this._cssWidth < 500;
    var x = this._cssWidth - pixelLength - 16;
    var y = compact ? 22 : this._cssHeight - 18;
    context.save();
    context.strokeStyle = 'rgba(38, 50, 57, 0.72)';
    context.fillStyle = COLORS.ink;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x, y - 5);
    context.lineTo(x, y + 5);
    context.moveTo(x, y);
    context.lineTo(x + pixelLength, y);
    context.moveTo(x + pixelLength, y - 5);
    context.lineTo(x + pixelLength, y + 5);
    context.stroke();
    context.font = '600 10px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillText(formatDistance(distance), x + pixelLength / 2, y - 5);
    context.restore();
  };

  FieldRenderer.prototype._drawPotentialLegend = function (context) {
    var scalar = this._cache.scalar;
    if (!scalar || !(scalar.clip > 0)) return;
    var width = clamp(this._cssWidth * 0.27, 132, 190);
    var x = 16;
    var y = this._cssHeight - 24;
    var barHeight = 7;
    var gradient = context.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, COLORS.negative);
    gradient.addColorStop(0.5, COLORS.neutral);
    gradient.addColorStop(1, COLORS.positive);

    context.save();
    context.fillStyle = 'rgba(245, 247, 246, 0.78)';
    context.fillRect(x - 4, y - 14, width + 8, 28);
    context.fillStyle = gradient;
    context.fillRect(x, y - barHeight / 2, width, barHeight);
    context.strokeStyle = 'rgba(36, 49, 55, 0.55)';
    context.lineWidth = 1;
    context.strokeRect(x, y - barHeight / 2, width, barHeight);
    context.beginPath();
    context.moveTo(x, y - 7);
    context.lineTo(x, y + 7);
    context.moveTo(x + width, y - 7);
    context.lineTo(x + width, y + 7);
    context.stroke();

    context.font = '600 9px system-ui, sans-serif';
    context.fillStyle = COLORS.ink;
    context.textBaseline = 'bottom';
    context.textAlign = 'left';
    context.fillText('<= -' + formatValue(scalar.clip, 'V'), x, y - 6);
    context.textAlign = 'center';
    context.fillText('0', x + width / 2, y - 6);
    context.textAlign = 'right';
    context.fillText('>= +' + formatValue(scalar.clip, 'V'), x + width, y - 6);
    context.restore();
  };

  FieldRenderer.prototype._targetPoint = function (target) {
    if (!target) return null;
    if (target.kind === 'charge') {
      return this.state.charges.find(function (charge) { return String(charge.id) === String(target.id); }) || null;
    }
    if (target.kind === 'probe') return this.state.probe;
    if (target.kind === 'point') return this.state.points[target.id] || null;
    if (target.kind === 'path') {
      return this.state.pathPoints.find(function (point, index) {
        return String(point.id) === String(target.id) || index === target.index;
      }) || null;
    }
    return null;
  };

  FieldRenderer.prototype._hitTest = function (screenPoint) {
    var candidates = [];
    var renderer = this;

    this.state.charges.forEach(function (charge) {
      if (charge.locked) return;
      candidates.push({ kind: 'charge', id: charge.id, point: charge, radius: renderer._chargeRadius(charge) + 7 });
    });
    if (this.state.probe && this.state.probe.locked !== true) {
      candidates.push({ kind: 'probe', id: this.state.probe.id || 'probe', point: this.state.probe, radius: 16 });
    }
    ['A', 'B'].forEach(function (id) {
      if (renderer.state.points[id]) candidates.push({ kind: 'point', id: id, point: renderer.state.points[id], radius: 15 });
    });
    this.state.pathPoints.forEach(function (point, index) {
      candidates.push({ kind: 'path', id: point.id, index: index, point: point, radius: 13 });
    });

    var best = null;
    var bestDistance = Infinity;
    for (var index = 0; index < candidates.length; index += 1) {
      var candidate = candidates[index];
      var candidateScreen = this.worldToScreen(candidate.point);
      var distance = Math.hypot(candidateScreen.x - screenPoint.x, candidateScreen.y - screenPoint.y);
      if (distance <= candidate.radius && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best ? { kind: best.kind, id: best.id, index: best.index } : null;
  };

  FieldRenderer.prototype._onPointerDown = function (event) {
    if (this._destroyed || event.button > 0) return;
    var screenPoint = this._eventScreenPoint(event);
    var target = this._hitTest(screenPoint);
    if (!target) return;
    event.preventDefault();
    target.pointerId = event.pointerId;
    this._drag = target;
    this._hover = target;
    this.canvas.style.cursor = 'grabbing';
    try { this.canvas.setPointerCapture(event.pointerId); } catch (error) { /* no-op */ }
    this._emitChange(target, 'start', event);
    this._requestFrame();
  };

  FieldRenderer.prototype._moveTarget = function (target, point) {
    var bounds = this._viewBounds();
    var margin = 7 / bounds.scale;
    point = {
      x: clamp(point.x, bounds.minX + margin, bounds.maxX - margin),
      y: clamp(point.y, bounds.minY + margin, bounds.maxY - margin)
    };
    var current = this._targetPoint(target);
    if (!current) return null;
    current.x = point.x;
    current.y = point.y;
    return { x: point.x, y: point.y };
  };

  FieldRenderer.prototype._onPointerMove = function (event) {
    if (this._destroyed) return;
    var screenPoint = this._eventScreenPoint(event);

    if (this._drag && this._drag.pointerId === event.pointerId) {
      event.preventDefault();
      var worldPoint = this.screenToWorld(screenPoint);
      var moved = this._moveTarget(this._drag, worldPoint);
      if (!moved) return;
      if (this._drag.kind === 'charge') this.invalidate({ full: false });
      else this._requestFrame();
      this._emitChange(this._drag, 'move', event, moved);
      return;
    }

    var hover = this._hitTest(screenPoint);
    var changed = safeSignature(hover) !== safeSignature(this._hover);
    this._hover = hover;
    this.canvas.style.cursor = hover ? 'grab' : this._originalCursor;
    if (changed) {
      if (typeof this.options.onHover === 'function') this.options.onHover(hover);
      this._requestFrame();
    }
  };

  FieldRenderer.prototype._onPointerUp = function (event) {
    if (!this._drag || this._drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    var target = this._drag;
    var point = this._targetPoint(target);
    this._drag = null;
    this.canvas.style.cursor = this._hover ? 'grab' : this._originalCursor;
    try { this.canvas.releasePointerCapture(event.pointerId); } catch (error) { /* no-op */ }
    this._emitChange(target, 'end', event, point && { x: point.x, y: point.y });
    if (target.kind === 'charge') this.invalidate({ full: true });
    else this._requestFrame();
  };

  FieldRenderer.prototype._onPointerLeave = function () {
    if (this._drag) return;
    this._hover = null;
    this.canvas.style.cursor = this._originalCursor;
    if (typeof this.options.onHover === 'function') this.options.onHover(null);
    this._requestFrame();
  };

  FieldRenderer.prototype._emitChange = function (target, phase, event, explicitPoint) {
    if (typeof this.options.onChange !== 'function') return;
    var point = explicitPoint || this._targetPoint(target);
    if (!point) return;
    this.options.onChange(target.kind, target.id, { x: point.x, y: point.y }, {
      phase: phase,
      index: target.index,
      originalEvent: event
    });
  };

  FieldRenderer.prototype.exportImage = function (type, quality) {
    var options = typeof type === 'object' && type ? type : { type: type, quality: quality };
    var mimeType = options.type || 'image/png';
    var imageQuality = clamp(finite(options.quality, 0.92), 0, 1);
    this.render(global.performance ? global.performance.now() : Date.now());

    if (options.asBlob) {
      var canvas = this.canvas;
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob);
          else reject(new Error('Canvas export failed.'));
        }, mimeType, imageQuality);
      });
    }
    return this.canvas.toDataURL(mimeType, imageQuality);
  };

  FieldRenderer.prototype.destroy = function () {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._raf !== null && typeof global.cancelAnimationFrame === 'function') {
      global.cancelAnimationFrame(this._raf);
    }
    this._raf = null;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    else global.removeEventListener('resize', this._onWindowResizeBound);
    this.canvas.removeEventListener('pointerdown', this._onPointerDownBound);
    this.canvas.removeEventListener('pointermove', this._onPointerMoveBound);
    this.canvas.removeEventListener('pointerup', this._onPointerUpBound);
    this.canvas.removeEventListener('pointercancel', this._onPointerUpBound);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeaveBound);
    this.canvas.style.touchAction = this._originalTouchAction;
    this.canvas.style.cursor = this._originalCursor;
    this._cache = this._emptyCache();
    this._lineOccupancy.clear();
  };

  global.FieldRenderer = FieldRenderer;
}(window));
