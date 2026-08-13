(function (global) {
  "use strict";

  var DEFAULTS = {
    visibleWidth: 0.8,
    centimetersPerWorldUnit: 100,
    gridSize: 37,
    verticalScale: 0.92,
    projection: "perspective",
    cameraDistance: 4.8,
    yaw: -0.72,
    pitch: 0.62,
    zoom: 1,
    minZoom: 0.62,
    maxZoom: 2.4,
    maxPixelRatio: 3,
    singularityRadius: null,
    interactive: true,
    backgroundTop: "#141b1e",
    backgroundBottom: "#080d0f"
  };

  var COLORS = {
    negativeDeep: [25, 111, 164],
    negative: [39, 190, 207],
    neutral: [224, 229, 225],
    positiveWarm: [246, 194, 82],
    positive: [239, 101, 83]
  };

  var EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function mix(a, b, amount) {
    return a + (b - a) * amount;
  }

  function mixColor(a, b, amount) {
    return [
      mix(a[0], b[0], amount),
      mix(a[1], b[1], amount),
      mix(a[2], b[2], amount)
    ];
  }

  function rgba(color, alpha, brightness) {
    var multiplier = finite(brightness, 1);
    return "rgba(" +
      Math.round(clamp(color[0] * multiplier, 0, 255)) + "," +
      Math.round(clamp(color[1] * multiplier, 0, 255)) + "," +
      Math.round(clamp(color[2] * multiplier, 0, 255)) + "," +
      clamp(alpha, 0, 1) + ")";
  }

  function surfaceColor(value, shade, alpha) {
    var color;
    var amount = clamp(Math.abs(value), 0, 1);

    if (value < 0) {
      color = amount < 0.58
        ? mixColor(COLORS.neutral, COLORS.negative, amount / 0.58)
        : mixColor(COLORS.negative, COLORS.negativeDeep, (amount - 0.58) / 0.42);
    } else {
      color = amount < 0.48
        ? mixColor(COLORS.neutral, COLORS.positiveWarm, amount / 0.48)
        : mixColor(COLORS.positiveWarm, COLORS.positive, (amount - 0.48) / 0.52);
    }

    return rgba(color, alpha, shade);
  }

  function quantile(sortedValues, position) {
    if (!sortedValues.length) {
      return 0;
    }

    var index = clamp(position, 0, 1) * (sortedValues.length - 1);
    var lower = Math.floor(index);
    var upper = Math.ceil(index);
    return mix(sortedValues[lower], sortedValues[upper], index - lower);
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    var r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function normalizeVector(x, y, z) {
    var length = Math.hypot(x, y, z) || 1;
    return { x: x / length, y: y / length, z: z / length };
  }

  function compactNumber(value) {
    var absolute = Math.abs(value);
    if (absolute >= 1000 || (absolute > 0 && absolute < 0.01)) {
      return value.toExponential(1);
    }
    if (absolute >= 100) {
      return value.toFixed(0);
    }
    if (absolute >= 10) {
      return value.toFixed(1).replace(/\.0$/, "");
    }
    return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function stateSignature(state) {
    if (!state) {
      return "";
    }
    try {
      return JSON.stringify({
        charges: state.charges || [],
        chargeUnit: state.chargeUnit,
        units: state.units,
        view: state.view,
        worldBounds: state.worldBounds,
        visibleWidth: state.visibleWidth,
        visibleHeight: state.visibleHeight
      });
    } catch (error) {
      return null;
    }
  }

  function SurfaceRenderer(canvas, options) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("SurfaceRenderer requires a canvas element.");
    }

    var core = global.PhysicsCore;
    if (!core || typeof core.potentialAt !== "function") {
      throw new Error("SurfaceRenderer requires window.PhysicsCore.potentialAt.");
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    if (!this.ctx) {
      throw new Error("SurfaceRenderer could not acquire a 2D canvas context.");
    }

    this.core = core;
    this.options = Object.assign({}, DEFAULTS, options || {});
    this._state = this.options.state || {};
    this._stateSignature = stateSignature(this._state);
    this._destroyed = false;
    this._frame = 0;
    this._dirty = true;
    this._surfaceCache = null;
    this._width = 1;
    this._height = 1;
    this._pixelRatio = 1;
    this._drag = null;
    this._camera = {
      yaw: finite(this.options.yaw, DEFAULTS.yaw),
      pitch: clamp(finite(this.options.pitch, DEFAULTS.pitch), 0.14, 1.25),
      zoom: clamp(
        finite(this.options.zoom, DEFAULTS.zoom),
        finite(this.options.minZoom, DEFAULTS.minZoom),
        finite(this.options.maxZoom, DEFAULTS.maxZoom)
      )
    };
    this._initialCamera = Object.assign({}, this._camera);
    this._originalTouchAction = canvas.style.touchAction;
    this._originalCursor = canvas.style.cursor;

    this._requestFrame = typeof global.requestAnimationFrame === "function"
      ? global.requestAnimationFrame.bind(global)
      : function (callback) { return global.setTimeout(function () { callback(Date.now()); }, 16); };
    this._cancelFrame = typeof global.cancelAnimationFrame === "function"
      ? global.cancelAnimationFrame.bind(global)
      : global.clearTimeout.bind(global);

    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onDoubleClick = this._handleDoubleClick.bind(this);
    this._onWindowResize = this.resize.bind(this);

    if (this.options.interactive !== false) {
      canvas.style.touchAction = "none";
      canvas.style.cursor = "grab";
      canvas.addEventListener("pointerdown", this._onPointerDown);
      canvas.addEventListener("pointermove", this._onPointerMove);
      canvas.addEventListener("pointerup", this._onPointerUp);
      canvas.addEventListener("pointercancel", this._onPointerUp);
      canvas.addEventListener("wheel", this._onWheel, { passive: false });
      canvas.addEventListener("dblclick", this._onDoubleClick);
    }

    global.addEventListener("resize", this._onWindowResize);
    if (typeof global.ResizeObserver === "function") {
      this._resizeObserver = new global.ResizeObserver(this._onWindowResize);
      this._resizeObserver.observe(canvas.parentElement || canvas);
    }

    this._syncCanvasSize();
    this.invalidate(true);
  }

  SurfaceRenderer.prototype.setState = function (state) {
    this._state = state || {};
    this._stateSignature = stateSignature(this._state);
    this.invalidate(true);
    return this;
  };

  SurfaceRenderer.prototype.invalidate = function (options) {
    if (this._destroyed) {
      return this;
    }

    var full = options === true || (options && options.full === true);
    if (full) {
      this._surfaceCache = null;
    }

    this._dirty = true;
    if (!this._frame) {
      var self = this;
      this._frame = this._requestFrame(function (time) {
        self._frame = 0;
        if (self._dirty && !self._destroyed) {
          self.render(time);
        }
      });
    }

    return this;
  };

  SurfaceRenderer.prototype.render = function () {
    if (this._destroyed) {
      return this;
    }

    this._dirty = false;
    if (this._syncCanvasSize()) {
      this._surfaceCache = null;
    }

    var state = this._getState();
    var nextStateSignature = stateSignature(state);
    if (nextStateSignature === null || nextStateSignature !== this._stateSignature) {
      this._stateSignature = nextStateSignature;
      this._surfaceCache = null;
    }
    var charges = this._getCharges(state);
    var bounds = this._getBounds(state);
    var surface = this._getSurface(bounds, charges);
    var camera = this._createProjection(bounds);

    this._projectSurface(surface, camera);
    this._paintBackground();
    this._drawZeroPlane(bounds, camera, false);
    this._drawSurface(surface, camera);
    this._drawSurfaceGrid(surface, camera);
    this._drawZeroContours(surface, camera);
    this._drawZeroPlane(bounds, camera, true);
    this._drawAxes(bounds, camera);
    this._drawCharges(charges, bounds, camera);
    this._drawOverlay();

    return this;
  };

  SurfaceRenderer.prototype.resize = function (width, height) {
    if (this._destroyed) {
      return this;
    }
    if (Number.isFinite(width)) {
      this.canvas.style.width = Math.max(1, Math.round(width)) + "px";
    }
    if (Number.isFinite(height)) {
      this.canvas.style.height = Math.max(1, Math.round(height)) + "px";
    }
    if (this._syncCanvasSize(width, height)) {
      this._surfaceCache = null;
    }
    this.invalidate(false);
    return this;
  };

  SurfaceRenderer.prototype.resetView = function () {
    this._camera = Object.assign({}, this._initialCamera);
    this.invalidate(false);
    return this;
  };

  SurfaceRenderer.prototype.exportImage = function (type, quality) {
    return this.canvas.toDataURL(type || "image/png", quality);
  };

  SurfaceRenderer.prototype.destroy = function () {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;
    if (this._frame) {
      this._cancelFrame(this._frame);
      this._frame = 0;
    }

    this.canvas.removeEventListener("pointerdown", this._onPointerDown);
    this.canvas.removeEventListener("pointermove", this._onPointerMove);
    this.canvas.removeEventListener("pointerup", this._onPointerUp);
    this.canvas.removeEventListener("pointercancel", this._onPointerUp);
    this.canvas.removeEventListener("wheel", this._onWheel);
    this.canvas.removeEventListener("dblclick", this._onDoubleClick);
    global.removeEventListener("resize", this._onWindowResize);

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    this.canvas.style.touchAction = this._originalTouchAction;
    this.canvas.style.cursor = this._originalCursor;
    this._surfaceCache = null;
    this._state = null;
  };

  SurfaceRenderer.prototype._getState = function () {
    if (typeof this.options.getState === "function") {
      return this.options.getState() || this._state || {};
    }
    return this._state || {};
  };

  SurfaceRenderer.prototype._chargeScaleToNC = function (state) {
    var units = state && state.units ? state.units : {};
    var unit = String((state && state.chargeUnit) || units.charge || "").toLowerCase();
    return unit === "c" || unit === "coulomb" || unit === "coulombs" ? 1e9 : 1;
  };

  SurfaceRenderer.prototype._getCharges = function (state) {
    var source = state && Array.isArray(state.charges) ? state.charges : [];
    var scale = this._chargeScaleToNC(state);
    return source.filter(function (charge) {
      return charge && Number.isFinite(charge.x) && Number.isFinite(charge.y) &&
        (Number.isFinite(charge.q) || Number.isFinite(charge.qC));
    }).map(function (charge) {
      // PhysicsCore always receives nC. Unqualified q is nC; qC is explicitly coulombs.
      var chargeNC = Number.isFinite(charge.qC) ? charge.qC * 1e9 : charge.q * scale;
      return Object.assign({}, charge, { q: chargeNC });
    });
  };

  SurfaceRenderer.prototype._getBounds = function (state) {
    var view = state && state.view ? state.view : {};
    var supplied = (state && state.worldBounds) || view.bounds;
    var viewHasBounds = Number.isFinite(view.xMin) || Number.isFinite(view.minX) ||
      Number.isFinite(view.xMax) || Number.isFinite(view.maxX) ||
      Number.isFinite(view.yMin) || Number.isFinite(view.minY) ||
      Number.isFinite(view.yMax) || Number.isFinite(view.maxY);
    if (!supplied && viewHasBounds) {
      supplied = view;
    }
    supplied = supplied || this.options.worldBounds;

    if (supplied) {
      var minX = finite(supplied.xMin, finite(supplied.minX, supplied.left));
      var maxX = finite(supplied.xMax, finite(supplied.maxX, supplied.right));
      var minY = finite(supplied.yMin, finite(supplied.minY, supplied.bottom));
      var maxY = finite(supplied.yMax, finite(supplied.maxY, supplied.top));
      if (Number.isFinite(minX) && Number.isFinite(maxX) && minX < maxX &&
          Number.isFinite(minY) && Number.isFinite(maxY) && minY < maxY) {
        return {
          minX: minX,
          maxX: maxX,
          minY: minY,
          maxY: maxY,
          width: maxX - minX,
          height: maxY - minY,
          centerX: (minX + maxX) * 0.5,
          centerY: (minY + maxY) * 0.5
        };
      }
    }

    var center = view.center || (state && state.center) || {};
    var centerX = finite(view.centerX, finite(center.x, 0));
    var centerY = finite(view.centerY, finite(center.y, 0));
    var visibleWidth = Math.max(
      0.01,
      finite(view.width, finite(
        view.visibleWidth,
        finite(state && state.visibleWidth, this.options.visibleWidth)
      ))
    );
    var visibleHeight = Math.max(0.01, finite(
      view.height,
      finite(
        view.visibleHeight,
        finite(state && state.visibleHeight, visibleWidth * this._height / Math.max(this._width, 1))
      )
    ));

    return {
      minX: centerX - visibleWidth * 0.5,
      maxX: centerX + visibleWidth * 0.5,
      minY: centerY - visibleHeight * 0.5,
      maxY: centerY + visibleHeight * 0.5,
      width: visibleWidth,
      height: visibleHeight,
      centerX: centerX,
      centerY: centerY
    };
  };

  SurfaceRenderer.prototype._syncCanvasSize = function (requestedWidth, requestedHeight) {
    var rect = this.canvas.getBoundingClientRect();
    var width = Math.max(1, Math.round(
      finite(requestedWidth, rect.width || this.canvas.clientWidth || this._width || 640)
    ));
    var height = Math.max(1, Math.round(
      finite(requestedHeight, rect.height || this.canvas.clientHeight || this._height || 420)
    ));
    var requestedRatio = typeof this.options.pixelRatio === "function"
      ? this.options.pixelRatio()
      : this.options.pixelRatio;
    var ratio = clamp(
      finite(requestedRatio, finite(global.devicePixelRatio, 1)),
      1,
      Math.max(1, finite(this.options.maxPixelRatio, DEFAULTS.maxPixelRatio))
    );
    var backingWidth = Math.round(width * ratio);
    var backingHeight = Math.round(height * ratio);
    var changed = width !== this._width || height !== this._height || ratio !== this._pixelRatio ||
      this.canvas.width !== backingWidth || this.canvas.height !== backingHeight;

    if (changed) {
      this._width = width;
      this._height = height;
      this._pixelRatio = ratio;
      this.canvas.width = backingWidth;
      this.canvas.height = backingHeight;
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    return changed;
  };

  SurfaceRenderer.prototype._surfaceKey = function (bounds, charges, columns, rows, maskRadius, unitScale) {
    var chargeKey = charges.map(function (charge) {
      return charge.x + "," + charge.y + "," + charge.q;
    }).join(";");
    return [
      bounds.minX, bounds.maxX, bounds.minY, bounds.maxY,
      columns, rows, maskRadius, unitScale, this.options.verticalScale, chargeKey
    ].join("|");
  };

  SurfaceRenderer.prototype._getSurface = function (bounds, charges) {
    var columns = clamp(Math.round(finite(this.options.gridSize, DEFAULTS.gridSize)), 13, 65);
    var worldStep = bounds.width / (columns - 1);
    var rows = clamp(Math.round(bounds.height / Math.max(worldStep, EPSILON)) + 1, 13, 65);
    var dx = bounds.width / (columns - 1);
    var dy = bounds.height / (rows - 1);
    var unitScale = Math.max(
      EPSILON,
      finite(this.options.centimetersPerWorldUnit, DEFAULTS.centimetersPerWorldUnit)
    );
    var coreRadiusCm = Math.max(0, finite(
      this.options.singularityRadius,
      finite(this.core.DEFAULT_SINGULARITY_RADIUS_CM, 0)
    ));
    var maskRadius = Math.max(coreRadiusCm / unitScale, Math.min(dx, dy) * 0.62);
    var key = this._surfaceKey(bounds, charges, columns, rows, maskRadius, unitScale);

    if (this._surfaceCache && this._surfaceCache.key === key) {
      return this._surfaceCache;
    }

    var activeCharges = charges.filter(function (charge) {
      return Math.abs(charge.q) > EPSILON;
    });
    var physicsCharges = charges.map(function (charge) {
      return { x: charge.x * unitScale, y: charge.y * unitScale, q: charge.q };
    });
    var coreMaskRadius = maskRadius * unitScale;
    var nodes = [];
    var absolutePotentials = [];
    var halfWidth = bounds.width * 0.5;
    var row;
    var column;

    for (row = 0; row < rows; row += 1) {
      var nodeRow = [];
      var y = bounds.minY + dy * row;
      for (column = 0; column < columns; column += 1) {
        var x = bounds.minX + dx * column;
        var masked = this._pointNearCharge(x, y, activeCharges, maskRadius);
        var potential = NaN;

        if (!masked) {
          try {
            potential = this.core.potentialAt(
              { x: x * unitScale, y: y * unitScale },
              physicsCharges,
              coreMaskRadius
            );
          } catch (error) {
            potential = NaN;
          }
        }

        var valid = !masked && Number.isFinite(potential);
        if (valid) {
          absolutePotentials.push(Math.abs(potential));
        }

        nodeRow.push({
          x: x,
          y: y,
          modelX: (x - bounds.centerX) / halfWidth,
          modelY: (y - bounds.centerY) / halfWidth,
          potential: potential,
          value: 0,
          modelZ: 0,
          valid: valid,
          projected: null
        });
      }
      nodes.push(nodeRow);
    }

    absolutePotentials.sort(function (a, b) { return a - b; });
    var robustClip = quantile(absolutePotentials, 0.9);
    if (!(robustClip > EPSILON)) {
      robustClip = Math.max(quantile(absolutePotentials, 1), 1);
    }
    var softScale = Math.max(robustClip * 0.18, EPSILON);
    var normalizer = Math.asinh(robustClip / softScale) || 1;
    var verticalScale = Math.max(0.1, finite(this.options.verticalScale, DEFAULTS.verticalScale));

    // This asinh normalization and clipping is display-only. Raw potential values stay untouched.
    for (row = 0; row < rows; row += 1) {
      for (column = 0; column < columns; column += 1) {
        var node = nodes[row][column];
        if (node.valid) {
          node.value = clamp(Math.asinh(node.potential / softScale) / normalizer, -1, 1);
          node.modelZ = node.value * verticalScale;
        }
      }
    }

    var cellMask = [];
    for (row = 0; row < rows - 1; row += 1) {
      var maskRow = [];
      for (column = 0; column < columns - 1; column += 1) {
        maskRow.push(this._cellNearCharge(
          nodes[row][column].x,
          nodes[row][column + 1].x,
          nodes[row][column].y,
          nodes[row + 1][column].y,
          activeCharges,
          maskRadius
        ));
      }
      cellMask.push(maskRow);
    }

    this._surfaceCache = {
      key: key,
      nodes: nodes,
      cellMask: cellMask,
      columns: columns,
      rows: rows,
      charges: activeCharges,
      maskRadius: maskRadius,
      clipPotential: robustClip,
      softScale: softScale
    };
    return this._surfaceCache;
  };

  SurfaceRenderer.prototype._pointNearCharge = function (x, y, charges, radius) {
    var radiusSquared = radius * radius;
    for (var index = 0; index < charges.length; index += 1) {
      var dx = x - charges[index].x;
      var dy = y - charges[index].y;
      if (dx * dx + dy * dy <= radiusSquared) {
        return true;
      }
    }
    return false;
  };

  SurfaceRenderer.prototype._cellNearCharge = function (minX, maxX, minY, maxY, charges, radius) {
    var radiusSquared = radius * radius;
    for (var index = 0; index < charges.length; index += 1) {
      var charge = charges[index];
      var nearestX = clamp(charge.x, minX, maxX);
      var nearestY = clamp(charge.y, minY, maxY);
      var dx = charge.x - nearestX;
      var dy = charge.y - nearestY;
      if (dx * dx + dy * dy <= radiusSquared) {
        return true;
      }
    }
    return false;
  };

  SurfaceRenderer.prototype._segmentNearCharge = function (a, b, charges, radius) {
    var abX = b.x - a.x;
    var abY = b.y - a.y;
    var lengthSquared = abX * abX + abY * abY;
    var radiusSquared = radius * radius;

    for (var index = 0; index < charges.length; index += 1) {
      var charge = charges[index];
      var amount = lengthSquared > EPSILON
        ? ((charge.x - a.x) * abX + (charge.y - a.y) * abY) / lengthSquared
        : 0;
      amount = clamp(amount, 0, 1);
      var dx = charge.x - (a.x + abX * amount);
      var dy = charge.y - (a.y + abY * amount);
      if (dx * dx + dy * dy <= radiusSquared) {
        return true;
      }
    }
    return false;
  };

  SurfaceRenderer.prototype._rawProjection = function (x, y, z) {
    var cosYaw = Math.cos(this._camera.yaw);
    var sinYaw = Math.sin(this._camera.yaw);
    var cosPitch = Math.cos(this._camera.pitch);
    var sinPitch = Math.sin(this._camera.pitch);
    var rotatedX = x * cosYaw - y * sinYaw;
    var rotatedY = x * sinYaw + y * cosYaw;
    var viewY = z * cosPitch - rotatedY * sinPitch;
    var depth = rotatedY * cosPitch + z * sinPitch;
    var perspective = this.options.projection === "orthographic"
      ? 1
      : finite(this.options.cameraDistance, DEFAULTS.cameraDistance) /
        Math.max(1.1, finite(this.options.cameraDistance, DEFAULTS.cameraDistance) - depth);

    return {
      x: rotatedX * perspective,
      y: -viewY * perspective,
      depth: depth,
      perspective: perspective
    };
  };

  SurfaceRenderer.prototype._createProjection = function (bounds) {
    var aspect = bounds.height / bounds.width;
    var vertical = Math.max(0.1, finite(this.options.verticalScale, DEFAULTS.verticalScale));
    var samples = [];
    var xs = [-1, 1];
    var ys = [-aspect, aspect];
    var zs = [-vertical, vertical];

    for (var xi = 0; xi < xs.length; xi += 1) {
      for (var yi = 0; yi < ys.length; yi += 1) {
        for (var zi = 0; zi < zs.length; zi += 1) {
          samples.push(this._rawProjection(xs[xi], ys[yi], zs[zi]));
        }
      }
    }

    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    samples.forEach(function (point) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });

    var horizontalPadding = clamp(this._width * 0.055, 18, 54);
    var verticalPadding = clamp(this._height * 0.09, 30, 58);
    var scaleX = (this._width - horizontalPadding * 2) / Math.max(maxX - minX, EPSILON);
    var scaleY = (this._height - verticalPadding * 2) / Math.max(maxY - minY, EPSILON);
    var scale = Math.max(1, Math.min(scaleX, scaleY)) * this._camera.zoom;

    return {
      scale: scale,
      originX: this._width * 0.5 - (minX + maxX) * 0.5 * scale,
      originY: this._height * 0.5 - (minY + maxY) * 0.5 * scale
    };
  };

  SurfaceRenderer.prototype._project = function (x, y, z, camera) {
    var raw = this._rawProjection(x, y, z);
    return {
      x: camera.originX + raw.x * camera.scale,
      y: camera.originY + raw.y * camera.scale,
      depth: raw.depth,
      perspective: raw.perspective
    };
  };

  SurfaceRenderer.prototype._worldToModel = function (x, y, bounds) {
    var halfWidth = bounds.width * 0.5;
    return {
      x: (x - bounds.centerX) / halfWidth,
      y: (y - bounds.centerY) / halfWidth
    };
  };

  SurfaceRenderer.prototype._projectSurface = function (surface, camera) {
    for (var row = 0; row < surface.rows; row += 1) {
      for (var column = 0; column < surface.columns; column += 1) {
        var node = surface.nodes[row][column];
        if (node.valid) {
          node.projected = this._project(node.modelX, node.modelY, node.modelZ, camera);
        } else {
          node.projected = null;
        }
      }
    }
  };

  SurfaceRenderer.prototype._paintBackground = function () {
    var ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this._pixelRatio, 0, 0, this._pixelRatio, 0, 0);
    ctx.clearRect(0, 0, this._width, this._height);
    var gradient = ctx.createLinearGradient(0, 0, 0, this._height);
    gradient.addColorStop(0, this.options.backgroundTop);
    gradient.addColorStop(1, this.options.backgroundBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this._width, this._height);
    ctx.restore();
  };

  SurfaceRenderer.prototype._drawZeroPlane = function (bounds, camera, outlineOnly) {
    var corners = [
      this._worldToModel(bounds.minX, bounds.minY, bounds),
      this._worldToModel(bounds.maxX, bounds.minY, bounds),
      this._worldToModel(bounds.maxX, bounds.maxY, bounds),
      this._worldToModel(bounds.minX, bounds.maxY, bounds)
    ].map(function (point) {
      return this._project(point.x, point.y, 0, camera);
    }, this);
    var ctx = this.ctx;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (var index = 1; index < corners.length; index += 1) {
      ctx.lineTo(corners[index].x, corners[index].y);
    }
    ctx.closePath();

    if (!outlineOnly) {
      ctx.fillStyle = "rgba(215, 226, 226, 0.035)";
      ctx.fill();
      ctx.strokeStyle = "rgba(207, 224, 225, 0.07)";
      ctx.lineWidth = 0.65;

      for (var step = 1; step < 6; step += 1) {
        var amount = step / 6;
        var x = mix(bounds.minX, bounds.maxX, amount);
        var y = mix(bounds.minY, bounds.maxY, amount);
        var xStart = this._worldToModel(x, bounds.minY, bounds);
        var xEnd = this._worldToModel(x, bounds.maxY, bounds);
        var yStart = this._worldToModel(bounds.minX, y, bounds);
        var yEnd = this._worldToModel(bounds.maxX, y, bounds);
        xStart = this._project(xStart.x, xStart.y, 0, camera);
        xEnd = this._project(xEnd.x, xEnd.y, 0, camera);
        yStart = this._project(yStart.x, yStart.y, 0, camera);
        yEnd = this._project(yEnd.x, yEnd.y, 0, camera);
        ctx.beginPath();
        ctx.moveTo(xStart.x, xStart.y);
        ctx.lineTo(xEnd.x, xEnd.y);
        ctx.moveTo(yStart.x, yStart.y);
        ctx.lineTo(yEnd.x, yEnd.y);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(221, 232, 232, 0.24)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  };

  SurfaceRenderer.prototype._drawSurface = function (surface) {
    var faces = [];
    var light = normalizeVector(-0.34, -0.45, 0.83);

    for (var row = 0; row < surface.rows - 1; row += 1) {
      for (var column = 0; column < surface.columns - 1; column += 1) {
        if (surface.cellMask[row][column]) {
          continue;
        }

        var a = surface.nodes[row][column];
        var b = surface.nodes[row][column + 1];
        var c = surface.nodes[row + 1][column + 1];
        var d = surface.nodes[row + 1][column];
        if (!a.valid || !b.valid || !c.valid || !d.valid) {
          continue;
        }

        var ux = b.modelX - a.modelX;
        var uy = b.modelY - a.modelY;
        var uz = b.modelZ - a.modelZ;
        var vx = d.modelX - a.modelX;
        var vy = d.modelY - a.modelY;
        var vz = d.modelZ - a.modelZ;
        var normal = normalizeVector(
          uy * vz - uz * vy,
          uz * vx - ux * vz,
          ux * vy - uy * vx
        );
        var illumination = clamp(
          normal.x * light.x + normal.y * light.y + normal.z * light.z,
          0,
          1
        );

        faces.push({
          points: [a.projected, b.projected, c.projected, d.projected],
          depth: (a.projected.depth + b.projected.depth + c.projected.depth + d.projected.depth) * 0.25,
          value: (a.value + b.value + c.value + d.value) * 0.25,
          shade: 0.7 + illumination * 0.34
        });
      }
    }

    faces.sort(function (left, right) { return left.depth - right.depth; });
    var ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = "round";

    faces.forEach(function (face) {
      var fill = surfaceColor(face.value, face.shade, 0.94);
      ctx.beginPath();
      ctx.moveTo(face.points[0].x, face.points[0].y);
      ctx.lineTo(face.points[1].x, face.points[1].y);
      ctx.lineTo(face.points[2].x, face.points[2].y);
      ctx.lineTo(face.points[3].x, face.points[3].y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = fill;
      ctx.lineWidth = 0.55;
      ctx.stroke();
    });

    ctx.restore();
  };

  SurfaceRenderer.prototype._drawSurfaceGrid = function (surface) {
    var segments = [];
    var row;
    var column;

    function collect(renderer, a, b) {
      if (!a.valid || !b.valid || !a.projected || !b.projected ||
          renderer._segmentNearCharge(a, b, surface.charges, surface.maskRadius)) {
        return;
      }
      segments.push({
        a: a.projected,
        b: b.projected,
        depth: (a.projected.depth + b.projected.depth) * 0.5,
        value: (a.value + b.value) * 0.5
      });
    }

    for (row = 0; row < surface.rows; row += 1) {
      for (column = 0; column < surface.columns - 1; column += 1) {
        collect(this, surface.nodes[row][column], surface.nodes[row][column + 1]);
      }
    }
    for (column = 0; column < surface.columns; column += 1) {
      for (row = 0; row < surface.rows - 1; row += 1) {
        collect(this, surface.nodes[row][column], surface.nodes[row + 1][column]);
      }
    }

    segments.sort(function (left, right) { return left.depth - right.depth; });
    var ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = clamp(this._pixelRatio * 0.46, 0.6, 1);
    segments.forEach(function (segment) {
      ctx.beginPath();
      ctx.moveTo(segment.a.x, segment.a.y);
      ctx.lineTo(segment.b.x, segment.b.y);
      ctx.strokeStyle = Math.abs(segment.value) < 0.12
        ? "rgba(247, 249, 244, 0.31)"
        : "rgba(7, 20, 23, 0.25)";
      ctx.stroke();
    });
    ctx.restore();
  };

  SurfaceRenderer.prototype._drawZeroContours = function (surface, camera) {
    var contours = [];

    function crossing(left, right) {
      if (!left.valid || !right.valid || left.value === right.value ||
          (left.value < 0) === (right.value < 0)) {
        return null;
      }
      var amount = clamp(-left.value / (right.value - left.value), 0, 1);
      return {
        x: mix(left.modelX, right.modelX, amount),
        y: mix(left.modelY, right.modelY, amount)
      };
    }

    for (var row = 0; row < surface.rows - 1; row += 1) {
      for (var column = 0; column < surface.columns - 1; column += 1) {
        if (surface.cellMask[row][column]) {
          continue;
        }
        var a = surface.nodes[row][column];
        var b = surface.nodes[row][column + 1];
        var c = surface.nodes[row + 1][column + 1];
        var d = surface.nodes[row + 1][column];
        var points = [crossing(a, b), crossing(b, c), crossing(c, d), crossing(d, a)]
          .filter(Boolean);
        if (points.length === 2) {
          contours.push([
            this._project(points[0].x, points[0].y, 0, camera),
            this._project(points[1].x, points[1].y, 0, camera)
          ]);
        } else if (points.length === 4) {
          contours.push([
            this._project(points[0].x, points[0].y, 0, camera),
            this._project(points[1].x, points[1].y, 0, camera)
          ]);
          contours.push([
            this._project(points[2].x, points[2].y, 0, camera),
            this._project(points[3].x, points[3].y, 0, camera)
          ]);
        }
      }
    }

    if (!contours.length) {
      return;
    }

    var ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = "rgba(249, 249, 237, 0.85)";
    ctx.lineWidth = 1.25;
    ctx.shadowColor = "rgba(245, 240, 207, 0.35)";
    ctx.shadowBlur = 4;
    contours.forEach(function (line) {
      ctx.beginPath();
      ctx.moveTo(line[0].x, line[0].y);
      ctx.lineTo(line[1].x, line[1].y);
      ctx.stroke();
    });
    ctx.restore();
  };

  SurfaceRenderer.prototype._drawAxes = function (bounds, camera) {
    var ctx = this.ctx;
    var self = this;

    function axis(start, end, color, label) {
      var a = self._worldToModel(start.x, start.y, bounds);
      var b = self._worldToModel(end.x, end.y, bounds);
      a = self._project(a.x, a.y, 0, camera);
      b = self._project(b.x, b.y, 0, camera);
      var angle = Math.atan2(b.y - a.y, b.x - a.x);
      var head = 6;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.35;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(angle - 0.48) * head, b.y - Math.sin(angle - 0.48) * head);
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - Math.cos(angle + 0.48) * head, b.y - Math.sin(angle + 0.48) * head);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, b.x + Math.cos(angle) * 10, b.y + Math.sin(angle) * 10);
    }

    ctx.save();
    if (bounds.minY <= 0 && bounds.maxY >= 0) {
      axis(
        { x: bounds.minX, y: 0 },
        { x: bounds.maxX, y: 0 },
        "rgba(244, 151, 112, 0.82)",
        "x"
      );
    }
    if (bounds.minX <= 0 && bounds.maxX >= 0) {
      axis(
        { x: 0, y: bounds.minY },
        { x: 0, y: bounds.maxY },
        "rgba(89, 201, 211, 0.82)",
        "y"
      );
    }

    if (bounds.minX <= 0 && bounds.maxX >= 0 && bounds.minY <= 0 && bounds.maxY >= 0) {
      var origin = this._worldToModel(0, 0, bounds);
      var bottom = this._project(origin.x, origin.y, -this.options.verticalScale, camera);
      var top = this._project(origin.x, origin.y, this.options.verticalScale, camera);
      ctx.beginPath();
      ctx.moveTo(bottom.x, bottom.y);
      ctx.lineTo(top.x, top.y);
      ctx.strokeStyle = "rgba(224, 230, 225, 0.43)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(232, 237, 231, 0.7)";
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("V", top.x + 5, top.y - 3);
    }
    ctx.restore();
  };

  SurfaceRenderer.prototype._drawCharges = function (charges, bounds, camera) {
    var vertical = Math.max(0.1, finite(this.options.verticalScale, DEFAULTS.verticalScale));
    var visible = charges.filter(function (charge) {
      return charge.x >= bounds.minX && charge.x <= bounds.maxX &&
        charge.y >= bounds.minY && charge.y <= bounds.maxY;
    }).map(function (charge) {
      var model = this._worldToModel(charge.x, charge.y, bounds);
      var base = this._project(model.x, model.y, 0, camera);
      var sign = charge.q < 0 ? -1 : charge.q > 0 ? 1 : 0;
      return {
        charge: charge,
        base: base,
        sign: sign,
        tip: this._project(model.x, model.y, sign * vertical * 0.9, camera)
      };
    }, this).sort(function (left, right) {
      return left.base.depth - right.base.depth;
    });

    var ctx = this.ctx;
    var showLabels = this._width >= 430 && visible.length <= 12;
    ctx.save();
    visible.forEach(function (item) {
      var positive = item.sign > 0;
      var negative = item.sign < 0;
      var color = positive ? "#f27661" : negative ? "#32bdd5" : "#9aa7a6";
      var glow = positive
        ? "rgba(242, 118, 97, 0.55)"
        : negative ? "rgba(50, 189, 213, 0.55)" : "rgba(154, 167, 166, 0.36)";

      if (item.sign !== 0) {
        ctx.beginPath();
        ctx.moveTo(item.base.x, item.base.y);
        ctx.lineTo(item.tip.x, item.tip.y);
        ctx.strokeStyle = positive
          ? "rgba(242, 118, 97, 0.47)"
          : "rgba(50, 189, 213, 0.47)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(item.tip.x, item.tip.y, 2.1, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }

      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = 11;
      ctx.beginPath();
      ctx.arc(item.base.x, item.base.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(8, 15, 17, 0.9)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = color;
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(positive ? "+" : negative ? "-" : "0", item.base.x, item.base.y - 0.5);

      if (showLabels) {
        var label = compactNumber(item.charge.q) + " nC";
        ctx.font = "500 10px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(231, 238, 235, 0.78)";
        ctx.fillText(label, item.base.x + 10, item.base.y + 1);
      }
    });
    ctx.restore();
  };

  SurfaceRenderer.prototype._drawOverlay = function () {
    var ctx = this.ctx;
    var compact = this._width < 360;
    var badgeWidth = compact ? 88 : 116;
    var badgeHeight = 34;
    var badgeX = this._width - badgeWidth - 12;
    var badgeY = 12;

    ctx.save();
    roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 6);
    ctx.fillStyle = "rgba(8, 13, 15, 0.76)";
    ctx.fill();
    ctx.strokeStyle = "rgba(224, 231, 226, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(235, 238, 230, 0.9)";
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(compact ? "高度经压缩" : "高度经 asinh 压缩", badgeX + badgeWidth * 0.5, badgeY + 11);
    ctx.fillStyle = "rgba(184, 196, 194, 0.68)";
    ctx.font = "500 9px system-ui, sans-serif";
    ctx.fillText("仅显示变换", badgeX + badgeWidth * 0.5, badgeY + 24);

    var legendX = 13;
    var legendY = this._height - 30;
    var legendWidth = compact ? 92 : 116;
    ctx.fillStyle = "rgba(219, 228, 226, 0.68)";
    ctx.font = "500 9px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("负", legendX, legendY + 16);
    ctx.textAlign = "center";
    ctx.fillText("0", legendX + legendWidth * 0.5, legendY + 16);
    ctx.textAlign = "right";
    ctx.fillText("正", legendX + legendWidth, legendY + 16);

    var gradient = ctx.createLinearGradient(legendX, 0, legendX + legendWidth, 0);
    gradient.addColorStop(0, "#196fa4");
    gradient.addColorStop(0.27, "#27becf");
    gradient.addColorStop(0.5, "#e0e5e1");
    gradient.addColorStop(0.72, "#f6c252");
    gradient.addColorStop(1, "#ef6553");
    roundedRect(ctx, legendX, legendY, legendWidth, 5, 2.5);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  };

  SurfaceRenderer.prototype._handlePointerDown = function (event) {
    if (event.button !== 0 || this._destroyed) {
      return;
    }
    this._drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: this._camera.yaw,
      pitch: this._camera.pitch
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = "grabbing";
    event.preventDefault();
  };

  SurfaceRenderer.prototype._handlePointerMove = function (event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) {
      return;
    }
    this._camera.yaw = this._drag.yaw + (event.clientX - this._drag.x) * 0.008;
    this._camera.pitch = clamp(
      this._drag.pitch + (event.clientY - this._drag.y) * 0.0065,
      0.14,
      1.25
    );
    this.invalidate(false);
    event.preventDefault();
  };

  SurfaceRenderer.prototype._handlePointerUp = function (event) {
    if (!this._drag || event.pointerId !== this._drag.pointerId) {
      return;
    }
    if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this._drag = null;
    this.canvas.style.cursor = "grab";
  };

  SurfaceRenderer.prototype._handleWheel = function (event) {
    var delta = clamp(event.deltaY, -240, 240);
    this._camera.zoom = clamp(
      this._camera.zoom * Math.exp(-delta * 0.0012),
      finite(this.options.minZoom, DEFAULTS.minZoom),
      finite(this.options.maxZoom, DEFAULTS.maxZoom)
    );
    this.invalidate(false);
    event.preventDefault();
  };

  SurfaceRenderer.prototype._handleDoubleClick = function (event) {
    this.resetView();
    event.preventDefault();
  };

  global.SurfaceRenderer = SurfaceRenderer;
})(window);
