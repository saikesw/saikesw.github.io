(function (root, factory) {
  "use strict";

  var PhysicsCore = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = PhysicsCore;
  }

  if (root) {
    root.PhysicsCore = PhysicsCore;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  var K = 8.9875517923e9;
  var NANOCOULOMB_TO_COULOMB = 1e-9;
  var CENTIMETER_TO_METER = 1e-2;
  var DEFAULT_SINGULARITY_RADIUS_CM = 0;
  var DEFAULT_INTEGRATION_TOLERANCE = 1e-8;
  var DEFAULT_INTEGRATION_MAX_DEPTH = 22;
  var TWO_PI = 2 * Math.PI;
  var GEOMETRY_EPSILON_CM = 1e-12;

  function assertFiniteNumber(value, name) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(name + " must be a finite number");
    }
    return value;
  }

  function assertNumber(value, name) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new TypeError(name + " must be a number");
    }
    return value;
  }

  function validatePoint(point, name) {
    if (!point || typeof point !== "object") {
      throw new TypeError((name || "point") + " must be an object with x and y coordinates");
    }
    assertFiniteNumber(point.x, (name || "point") + ".x");
    assertFiniteNumber(point.y, (name || "point") + ".y");
    return point;
  }

  function validateCharges(charges) {
    if (!Array.isArray(charges)) {
      throw new TypeError("charges must be an array");
    }

    for (var i = 0; i < charges.length; i += 1) {
      validatePoint(charges[i], "charges[" + i + "]");
      assertFiniteNumber(charges[i].q, "charges[" + i + "].q");
    }

    return charges;
  }

  function resolveSingularityRadius(value) {
    if (value === undefined || value === null) {
      return DEFAULT_SINGULARITY_RADIUS_CM;
    }
    assertFiniteNumber(value, "singularityRadius");
    if (value < 0) {
      throw new RangeError("singularityRadius must be non-negative");
    }
    return value;
  }

  function chargeValue(charge, name) {
    var value = charge;
    if (charge && typeof charge === "object") {
      value = charge.q;
    }
    return assertFiniteNumber(value, name || "charge");
  }

  function copyPoint(point) {
    validatePoint(point, "point");
    return { x: point.x, y: point.y };
  }

  function nCToC(value) {
    return assertFiniteNumber(value, "nanocoulombs") * NANOCOULOMB_TO_COULOMB;
  }

  function cToNC(value) {
    return assertFiniteNumber(value, "coulombs") / NANOCOULOMB_TO_COULOMB;
  }

  function cmToM(value) {
    return assertFiniteNumber(value, "centimeters") * CENTIMETER_TO_METER;
  }

  function mToCm(value) {
    return assertFiniteNumber(value, "meters") / CENTIMETER_TO_METER;
  }

  function compensatedAdd(state, value) {
    var adjusted = value - state.compensation;
    var next = state.sum + adjusted;
    state.compensation = (next - state.sum) - adjusted;
    state.sum = next;
  }

  function computeFieldAtXY(x, y, charges, singularityRadius, includeContributions) {
    var exState = { sum: 0, compensation: 0 };
    var eyState = { sum: 0, compensation: 0 };
    var contributions = includeContributions ? [] : null;
    var singular = false;

    for (var i = 0; i < charges.length; i += 1) {
      var charge = charges[i];
      var dxCm = x - charge.x;
      var dyCm = y - charge.y;
      var distanceCm = Math.hypot(dxCm, dyCm);
      var contribution;

      if (charge.q !== 0 && distanceCm <= singularityRadius) {
        singular = true;
        if (includeContributions) {
          contributions.push({
            index: i,
            charge: charge,
            dx: dxCm,
            dy: dyCm,
            distance: distanceCm,
            distanceCm: distanceCm,
            distanceMeters: distanceCm * CENTIMETER_TO_METER,
            ex: NaN,
            ey: NaN,
            magnitude: Infinity,
            singular: true
          });
        }
        continue;
      }

      if (charge.q === 0) {
        contribution = {
          ex: 0,
          ey: 0,
          magnitude: 0
        };
      } else {
        var dxMeters = dxCm * CENTIMETER_TO_METER;
        var dyMeters = dyCm * CENTIMETER_TO_METER;
        var distanceMeters = distanceCm * CENTIMETER_TO_METER;
        var scalar = K * charge.q * NANOCOULOMB_TO_COULOMB /
          (distanceMeters * distanceMeters * distanceMeters);

        contribution = {
          ex: scalar * dxMeters,
          ey: scalar * dyMeters,
          magnitude: Math.abs(K * charge.q * NANOCOULOMB_TO_COULOMB /
            (distanceMeters * distanceMeters))
        };

        compensatedAdd(exState, contribution.ex);
        compensatedAdd(eyState, contribution.ey);
      }

      if (includeContributions) {
        contributions.push({
          index: i,
          charge: charge,
          dx: dxCm,
          dy: dyCm,
          distance: distanceCm,
          distanceCm: distanceCm,
          distanceMeters: distanceCm * CENTIMETER_TO_METER,
          ex: contribution.ex,
          ey: contribution.ey,
          magnitude: contribution.magnitude,
          singular: false
        });
      }
    }

    if (singular) {
      return {
        ex: NaN,
        ey: NaN,
        magnitude: Infinity,
        contributions: contributions,
        singular: true
      };
    }

    return {
      ex: exState.sum,
      ey: eyState.sum,
      magnitude: Math.hypot(exState.sum, eyState.sum),
      contributions: contributions,
      singular: false
    };
  }

  function fieldAt(point, charges, singularityRadius) {
    validatePoint(point, "point");
    validateCharges(charges);
    var radius = resolveSingularityRadius(singularityRadius);
    return computeFieldAtXY(point.x, point.y, charges, radius, true);
  }

  function potentialAt(point, charges, singularityRadius) {
    validatePoint(point, "point");
    validateCharges(charges);
    var radius = resolveSingularityRadius(singularityRadius);
    var potential = { sum: 0, compensation: 0 };
    var positiveSingularity = false;
    var negativeSingularity = false;

    for (var i = 0; i < charges.length; i += 1) {
      var charge = charges[i];
      if (charge.q === 0) {
        continue;
      }

      var distanceCm = Math.hypot(point.x - charge.x, point.y - charge.y);
      if (distanceCm <= radius) {
        positiveSingularity = positiveSingularity || charge.q > 0;
        negativeSingularity = negativeSingularity || charge.q < 0;
        continue;
      }

      var distanceMeters = distanceCm * CENTIMETER_TO_METER;
      compensatedAdd(
        potential,
        K * charge.q * NANOCOULOMB_TO_COULOMB / distanceMeters
      );
    }

    if (positiveSingularity && negativeSingularity) {
      return NaN;
    }
    if (positiveSingularity) {
      return Infinity;
    }
    if (negativeSingularity) {
      return -Infinity;
    }
    return potential.sum;
  }

  function withoutIdentity(charges, excludedCharge) {
    if (!excludedCharge) {
      return charges;
    }
    return charges.filter(function (charge) {
      return charge !== excludedCharge;
    });
  }

  function resolveForceArguments(point, second, third, fourth) {
    var sources;
    var testChargeNC;
    var radius;
    var excludedCharge = null;

    if (Array.isArray(second)) {
      sources = second;
      if (Object.prototype.hasOwnProperty.call(point, "q")) {
        testChargeNC = chargeValue(point, "point.q");
        radius = third;
        excludedCharge = point;
      } else {
        testChargeNC = chargeValue(third, "testCharge");
        radius = fourth;
      }
    } else {
      testChargeNC = chargeValue(second, "testCharge");
      sources = third;
      radius = fourth;
    }

    validateCharges(sources);
    return {
      sources: withoutIdentity(sources, excludedCharge),
      testChargeNC: testChargeNC,
      singularityRadius: resolveSingularityRadius(radius)
    };
  }

  function forceAt(point, second, third, fourth) {
    validatePoint(point, "point");
    var args = resolveForceArguments(point, second, third, fourth);
    var field = computeFieldAtXY(
      point.x,
      point.y,
      args.sources,
      args.singularityRadius,
      true
    );
    var testChargeCoulombs = args.testChargeNC * NANOCOULOMB_TO_COULOMB;

    return {
      fx: field.ex * testChargeCoulombs,
      fy: field.ey * testChargeCoulombs,
      magnitude: field.singular ? Infinity : field.magnitude * Math.abs(testChargeCoulombs),
      contributions: field.contributions.map(function (contribution) {
        return {
          index: contribution.index,
          charge: contribution.charge,
          fx: contribution.ex * testChargeCoulombs,
          fy: contribution.ey * testChargeCoulombs,
          magnitude: contribution.singular ? Infinity :
            contribution.magnitude * Math.abs(testChargeCoulombs),
          singular: contribution.singular
        };
      }),
      field: field,
      singular: field.singular
    };
  }

  function potentialEnergy(first, second, third, fourth) {
    if ((typeof first === "number" || (first && typeof first === "object" &&
        Object.prototype.hasOwnProperty.call(first, "q"))) &&
        typeof second === "number" && third === undefined) {
      return chargeValue(first, "charge") * NANOCOULOMB_TO_COULOMB *
        assertNumber(second, "potential");
    }

    var point;
    var testChargeNC;
    var sources;
    var radius;
    var excludedCharge = null;

    if (first && typeof first === "object" && Array.isArray(second)) {
      point = first;
      testChargeNC = chargeValue(first, "point.q");
      sources = second;
      radius = third;
      excludedCharge = first;
    } else if (first && typeof first === "object" && Array.isArray(third)) {
      point = first;
      testChargeNC = chargeValue(second, "testCharge");
      sources = third;
      radius = fourth;
    } else if ((typeof first === "number" || (first && typeof first === "object" &&
        Object.prototype.hasOwnProperty.call(first, "q"))) &&
        second && typeof second === "object" && Array.isArray(third)) {
      testChargeNC = chargeValue(first, "testCharge");
      point = second;
      sources = third;
      radius = fourth;
    } else {
      throw new TypeError("potentialEnergy expects (chargeNC, potentialV) or point/charge/source arguments");
    }

    validatePoint(point, "point");
    validateCharges(sources);
    var phi = potentialAt(
      point,
      withoutIdentity(sources, excludedCharge),
      resolveSingularityRadius(radius)
    );
    return testChargeNC * NANOCOULOMB_TO_COULOMB * phi;
  }

  function potentialDifference(phiA, phiB) {
    return assertNumber(phiA, "phiA") - assertNumber(phiB, "phiB");
  }

  function potentialChange(phiA, phiB) {
    return assertNumber(phiB, "phiB") - assertNumber(phiA, "phiA");
  }

  function electricWork(charge, phiA, phiB) {
    return chargeValue(charge, "charge") * NANOCOULOMB_TO_COULOMB *
      potentialDifference(phiA, phiB);
  }

  function sourceSystemEnergy(charges, singularityRadius) {
    validateCharges(charges);
    var radius = resolveSingularityRadius(singularityRadius);
    var energy = { sum: 0, compensation: 0 };
    var positiveSingularity = false;
    var negativeSingularity = false;

    for (var i = 0; i < charges.length; i += 1) {
      for (var j = i + 1; j < charges.length; j += 1) {
        var product = charges[i].q * charges[j].q;
        if (product === 0) {
          continue;
        }

        var distanceCm = Math.hypot(
          charges[i].x - charges[j].x,
          charges[i].y - charges[j].y
        );

        if (distanceCm <= radius) {
          positiveSingularity = positiveSingularity || product > 0;
          negativeSingularity = negativeSingularity || product < 0;
          continue;
        }

        compensatedAdd(
          energy,
          K * product * NANOCOULOMB_TO_COULOMB * NANOCOULOMB_TO_COULOMB /
            (distanceCm * CENTIMETER_TO_METER)
        );
      }
    }

    if (positiveSingularity && negativeSingularity) {
      return NaN;
    }
    if (positiveSingularity) {
      return Infinity;
    }
    if (negativeSingularity) {
      return -Infinity;
    }
    return energy.sum;
  }

  function createLinePath(start, end) {
    return {
      type: "line",
      start: copyPoint(start),
      end: copyPoint(end)
    };
  }

  function createPolylinePath(points) {
    if (!Array.isArray(points) || points.length < 2) {
      throw new RangeError("a polyline path requires at least two points");
    }
    return {
      type: "polyline",
      points: points.map(copyPoint)
    };
  }

  function normalizedPositiveAngle(angle) {
    var normalized = angle % TWO_PI;
    return normalized < 0 ? normalized + TWO_PI : normalized;
  }

  function resolveArcSweep(startAngle, endAngle, clockwise) {
    var difference = endAngle - startAngle;
    if (clockwise === true) {
      var clockwiseMagnitude = normalizedPositiveAngle(startAngle - endAngle);
      if (clockwiseMagnitude < Number.EPSILON) {
        clockwiseMagnitude = TWO_PI;
      }
      return -clockwiseMagnitude;
    }
    if (clockwise === false) {
      var counterclockwiseMagnitude = normalizedPositiveAngle(difference);
      if (counterclockwiseMagnitude < Number.EPSILON) {
        counterclockwiseMagnitude = TWO_PI;
      }
      return counterclockwiseMagnitude;
    }
    return difference;
  }

  function pointOnArc(center, radius, angle) {
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle)
    };
  }

  function createArcPath(center, radius, startAngle, endAngle, clockwiseOrOptions) {
    var options = clockwiseOrOptions;
    var clockwise;
    var angleUnit = "radians";

    if (typeof options === "boolean" || options === undefined) {
      clockwise = options;
    } else if (options && typeof options === "object") {
      clockwise = options.clockwise;
      angleUnit = options.angleUnit || options.units || "radians";
    } else {
      throw new TypeError("arc options must be a boolean or an options object");
    }

    var copiedCenter = copyPoint(center);
    assertFiniteNumber(radius, "radius");
    if (radius <= 0) {
      throw new RangeError("arc radius must be greater than zero");
    }
    assertFiniteNumber(startAngle, "startAngle");
    assertFiniteNumber(endAngle, "endAngle");

    if (angleUnit === "degrees") {
      startAngle = startAngle * Math.PI / 180;
      endAngle = endAngle * Math.PI / 180;
    } else if (angleUnit !== "radians") {
      throw new RangeError("angleUnit must be 'radians' or 'degrees'");
    }

    var sweepAngle = resolveArcSweep(startAngle, endAngle, clockwise);
    return {
      type: "arc",
      center: copiedCenter,
      radius: radius,
      startAngle: startAngle,
      endAngle: startAngle + sweepAngle,
      sweepAngle: sweepAngle,
      clockwise: sweepAngle < 0,
      start: pointOnArc(copiedCenter, radius, startAngle),
      end: pointOnArc(copiedCenter, radius, startAngle + sweepAngle)
    };
  }

  function pathSegments(path) {
    if (Array.isArray(path)) {
      path = createPolylinePath(path);
    }
    if (!path || typeof path !== "object") {
      throw new TypeError("path must be a line, polyline, or arc path");
    }

    if (path.type === "line") {
      return [{
        type: "line",
        start: copyPoint(path.start),
        end: copyPoint(path.end)
      }];
    }

    if (path.type === "polyline") {
      if (!Array.isArray(path.points) || path.points.length < 2) {
        throw new RangeError("a polyline path requires at least two points");
      }
      var segments = [];
      for (var i = 0; i < path.points.length - 1; i += 1) {
        segments.push({
          type: "line",
          start: copyPoint(path.points[i]),
          end: copyPoint(path.points[i + 1])
        });
      }
      return segments;
    }

    if (path.type === "arc") {
      var center = copyPoint(path.center);
      var radius = assertFiniteNumber(path.radius, "path.radius");
      if (radius <= 0) {
        throw new RangeError("arc radius must be greater than zero");
      }
      var startAngle = assertFiniteNumber(path.startAngle, "path.startAngle");
      var sweepAngle;
      if (typeof path.sweepAngle === "number") {
        sweepAngle = assertFiniteNumber(path.sweepAngle, "path.sweepAngle");
      } else {
        sweepAngle = resolveArcSweep(
          startAngle,
          assertFiniteNumber(path.endAngle, "path.endAngle"),
          path.clockwise
        );
      }
      return [{
        type: "arc",
        center: center,
        radius: radius,
        startAngle: startAngle,
        sweepAngle: sweepAngle
      }];
    }

    throw new RangeError("unknown path type: " + path.type);
  }

  function nearestCharge(point, charges) {
    validatePoint(point, "point");
    validateCharges(charges);
    var nearest = null;

    for (var i = 0; i < charges.length; i += 1) {
      var dx = point.x - charges[i].x;
      var dy = point.y - charges[i].y;
      var distance = Math.hypot(dx, dy);
      if (!nearest || distance < nearest.distance) {
        nearest = {
          index: i,
          charge: charges[i],
          dx: dx,
          dy: dy,
          distance: distance,
          distanceCm: distance
        };
      }
    }

    return nearest;
  }

  function closestPointOnLine(point, segment) {
    var dx = segment.end.x - segment.start.x;
    var dy = segment.end.y - segment.start.y;
    var lengthSquared = dx * dx + dy * dy;
    var t = 0;

    if (lengthSquared > 0) {
      t = ((point.x - segment.start.x) * dx +
        (point.y - segment.start.y) * dy) / lengthSquared;
      t = Math.max(0, Math.min(1, t));
    }

    var closestPoint = {
      x: segment.start.x + t * dx,
      y: segment.start.y + t * dy
    };
    return {
      point: closestPoint,
      distance: Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y),
      parameter: t
    };
  }

  function angleFallsOnSweep(angle, startAngle, sweepAngle) {
    if (Math.abs(sweepAngle) >= TWO_PI - Number.EPSILON * 16) {
      return true;
    }
    if (sweepAngle >= 0) {
      return normalizedPositiveAngle(angle - startAngle) <=
        sweepAngle + Number.EPSILON * 16;
    }
    return normalizedPositiveAngle(startAngle - angle) <=
      -sweepAngle + Number.EPSILON * 16;
  }

  function closestPointOnArc(point, segment) {
    var startPoint = pointOnArc(segment.center, segment.radius, segment.startAngle);
    var endAngle = segment.startAngle + segment.sweepAngle;
    var endPoint = pointOnArc(segment.center, segment.radius, endAngle);
    var startDistance = Math.hypot(point.x - startPoint.x, point.y - startPoint.y);
    var endDistance = Math.hypot(point.x - endPoint.x, point.y - endPoint.y);
    var bestPoint = startDistance <= endDistance ? startPoint : endPoint;
    var bestDistance = Math.min(startDistance, endDistance);
    var dx = point.x - segment.center.x;
    var dy = point.y - segment.center.y;
    var centerDistance = Math.hypot(dx, dy);

    if (centerDistance > 0) {
      var radialAngle = Math.atan2(dy, dx);
      if (angleFallsOnSweep(radialAngle, segment.startAngle, segment.sweepAngle)) {
        var radialPoint = pointOnArc(segment.center, segment.radius, radialAngle);
        var radialDistance = Math.abs(centerDistance - segment.radius);
        if (radialDistance < bestDistance) {
          bestPoint = radialPoint;
          bestDistance = radialDistance;
        }
      }
    }

    return {
      point: bestPoint,
      distance: bestDistance
    };
  }

  function closestPointOnPathSegment(point, segment) {
    return segment.type === "arc" ?
      closestPointOnArc(point, segment) : closestPointOnLine(point, segment);
  }

  function nearestChargeToPathInternal(path, charges, ignoreZeroCharges) {
    var segments = pathSegments(path);
    var nearest = null;

    for (var chargeIndex = 0; chargeIndex < charges.length; chargeIndex += 1) {
      if (ignoreZeroCharges && charges[chargeIndex].q === 0) {
        continue;
      }
      for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        var closest = closestPointOnPathSegment(charges[chargeIndex], segments[segmentIndex]);
        if (!nearest || closest.distance < nearest.distance) {
          nearest = {
            index: chargeIndex,
            charge: charges[chargeIndex],
            distance: closest.distance,
            distanceCm: closest.distance,
            closestPoint: closest.point,
            segmentIndex: segmentIndex,
            segmentType: segments[segmentIndex].type
          };
        }
      }
    }

    return nearest;
  }

  function nearestChargeToPath(path, charges) {
    validateCharges(charges);
    return nearestChargeToPathInternal(path, charges, false);
  }

  function findPathSingularity(path, charges, singularityRadius) {
    validateCharges(charges);
    var radius = resolveSingularityRadius(singularityRadius);
    var nearest = nearestChargeToPathInternal(path, charges, true);
    if (!nearest) {
      return null;
    }

    var threshold = radius === 0 ? GEOMETRY_EPSILON_CM : radius;
    if (nearest.distance > threshold) {
      return null;
    }

    return {
      singular: true,
      index: nearest.index,
      charge: nearest.charge,
      distance: nearest.distance,
      distanceCm: nearest.distance,
      closestPoint: nearest.closestPoint,
      segmentIndex: nearest.segmentIndex,
      segmentType: nearest.segmentType,
      singularityRadius: radius
    };
  }

  function pathCrossesSingularity(path, charges, singularityRadius) {
    return findPathSingularity(path, charges, singularityRadius) !== null;
  }

  function adaptiveSimpsonRecursive(f, a, b, fa, fm, fb, whole, tolerance, depth) {
    var middle = (a + b) / 2;
    var leftMiddle = (a + middle) / 2;
    var rightMiddle = (middle + b) / 2;
    var fLeftMiddle = f(leftMiddle);
    var fRightMiddle = f(rightMiddle);

    if (!Number.isFinite(fLeftMiddle) || !Number.isFinite(fRightMiddle)) {
      return NaN;
    }

    var left = (middle - a) * (fa + 4 * fLeftMiddle + fm) / 6;
    var right = (b - middle) * (fm + 4 * fRightMiddle + fb) / 6;
    var combined = left + right;
    var error = combined - whole;

    if (depth <= 0 || Math.abs(error) <= 15 * tolerance) {
      return combined + error / 15;
    }

    var leftResult = adaptiveSimpsonRecursive(
      f, a, middle, fa, fLeftMiddle, fm, left, tolerance / 2, depth - 1
    );
    if (!Number.isFinite(leftResult)) {
      return NaN;
    }
    var rightResult = adaptiveSimpsonRecursive(
      f, middle, b, fm, fRightMiddle, fb, right, tolerance / 2, depth - 1
    );
    return Number.isFinite(rightResult) ? leftResult + rightResult : NaN;
  }

  function adaptiveSimpson(f, tolerance, maxDepth) {
    var fa = f(0);
    var fm = f(0.5);
    var fb = f(1);
    if (!Number.isFinite(fa) || !Number.isFinite(fm) || !Number.isFinite(fb)) {
      return NaN;
    }
    var whole = (fa + 4 * fm + fb) / 6;
    return adaptiveSimpsonRecursive(
      f, 0, 1, fa, fm, fb, whole, tolerance, maxDepth
    );
  }

  function resolveIntegrationOptions(optionsOrRadius, toleranceOverride) {
    var options = {};
    if (typeof optionsOrRadius === "number") {
      options.singularityRadius = optionsOrRadius;
    } else if (optionsOrRadius !== undefined && optionsOrRadius !== null) {
      if (typeof optionsOrRadius !== "object") {
        throw new TypeError("line integral options must be a radius or an options object");
      }
      options = optionsOrRadius;
    }

    var tolerance = toleranceOverride === undefined ? options.tolerance : toleranceOverride;
    if (tolerance === undefined) {
      tolerance = DEFAULT_INTEGRATION_TOLERANCE;
    }
    assertFiniteNumber(tolerance, "tolerance");
    if (tolerance <= 0) {
      throw new RangeError("tolerance must be greater than zero");
    }

    var maxDepth = options.maxDepth === undefined ?
      DEFAULT_INTEGRATION_MAX_DEPTH : options.maxDepth;
    assertFiniteNumber(maxDepth, "maxDepth");
    if (!Number.isInteger(maxDepth) || maxDepth < 1) {
      throw new RangeError("maxDepth must be a positive integer");
    }

    return {
      singularityRadius: resolveSingularityRadius(options.singularityRadius),
      tolerance: tolerance,
      maxDepth: maxDepth,
      throwOnSingularity: options.throwOnSingularity === true
    };
  }

  function segmentIntegrand(segment, charges, singularityRadius) {
    if (segment.type === "line") {
      var dxCm = segment.end.x - segment.start.x;
      var dyCm = segment.end.y - segment.start.y;
      return function (t) {
        var x = segment.start.x + dxCm * t;
        var y = segment.start.y + dyCm * t;
        var field = computeFieldAtXY(x, y, charges, singularityRadius, false);
        if (field.singular) {
          return NaN;
        }
        return field.ex * dxCm * CENTIMETER_TO_METER +
          field.ey * dyCm * CENTIMETER_TO_METER;
      };
    }

    return function (t) {
      var angle = segment.startAngle + segment.sweepAngle * t;
      var x = segment.center.x + segment.radius * Math.cos(angle);
      var y = segment.center.y + segment.radius * Math.sin(angle);
      var derivativeXcm = -segment.radius * Math.sin(angle) * segment.sweepAngle;
      var derivativeYcm = segment.radius * Math.cos(angle) * segment.sweepAngle;
      var field = computeFieldAtXY(x, y, charges, singularityRadius, false);
      if (field.singular) {
        return NaN;
      }
      return field.ex * derivativeXcm * CENTIMETER_TO_METER +
        field.ey * derivativeYcm * CENTIMETER_TO_METER;
    };
  }

  function lineIntegral(path, charges, optionsOrRadius, toleranceOverride) {
    validateCharges(charges);
    var options = resolveIntegrationOptions(optionsOrRadius, toleranceOverride);
    var singularity = findPathSingularity(path, charges, options.singularityRadius);
    if (singularity) {
      if (options.throwOnSingularity) {
        throw new RangeError("path crosses the singularity of charge " + singularity.index);
      }
      return NaN;
    }

    var segments = pathSegments(path);
    var result = { sum: 0, compensation: 0 };
    var perSegmentTolerance = options.tolerance / Math.max(1, segments.length);

    for (var i = 0; i < segments.length; i += 1) {
      var integral = adaptiveSimpson(
        segmentIntegrand(segments[i], charges, options.singularityRadius),
        perSegmentTolerance,
        options.maxDepth
      );
      if (!Number.isFinite(integral)) {
        return NaN;
      }
      compensatedAdd(result, integral);
    }

    return result.sum;
  }

  function formatScientific(value, significantDigits) {
    assertNumber(value, "value");
    if (value === Infinity) {
      return "Infinity";
    }
    if (value === -Infinity) {
      return "-Infinity";
    }
    if (value === 0) {
      return "0";
    }

    var digits = significantDigits === undefined ? 3 : significantDigits;
    assertFiniteNumber(digits, "significantDigits");
    if (!Number.isInteger(digits) || digits < 1 || digits > 100) {
      throw new RangeError("significantDigits must be an integer from 1 to 100");
    }

    var parts = value.toExponential(digits - 1).split("e");
    var exponent = Number(parts[1]);
    return parts[0] + "e" + (exponent >= 0 ? "+" : "") + exponent;
  }

  var api = {
    K: K,
    NANOCOULOMB_TO_COULOMB: NANOCOULOMB_TO_COULOMB,
    CENTIMETER_TO_METER: CENTIMETER_TO_METER,
    DEFAULT_SINGULARITY_RADIUS_CM: DEFAULT_SINGULARITY_RADIUS_CM,
    DEFAULT_INTEGRATION_TOLERANCE: DEFAULT_INTEGRATION_TOLERANCE,
    nCToC: nCToC,
    cToNC: cToNC,
    cmToM: cmToM,
    mToCm: mToCm,
    toSICharge: nCToC,
    fromSICharge: cToNC,
    toSIDistance: cmToM,
    fromSIDistance: mToCm,
    fieldAt: fieldAt,
    potentialAt: potentialAt,
    forceAt: forceAt,
    potentialEnergy: potentialEnergy,
    potentialDifference: potentialDifference,
    potentialChange: potentialChange,
    electricWork: electricWork,
    sourceSystemEnergy: sourceSystemEnergy,
    createLinePath: createLinePath,
    createPolylinePath: createPolylinePath,
    createArcPath: createArcPath,
    linePath: createLinePath,
    polylinePath: createPolylinePath,
    arcPath: createArcPath,
    pathSegments: pathSegments,
    nearestCharge: nearestCharge,
    nearestChargeToPath: nearestChargeToPath,
    findPathSingularity: findPathSingularity,
    pathCrossesSingularity: pathCrossesSingularity,
    pathIntersectsSingularity: pathCrossesSingularity,
    lineIntegral: lineIntegral,
    formatScientific: formatScientific
  };

  return Object.freeze(api);
});
