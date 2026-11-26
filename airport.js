const $ = id => document.getElementById(id);

async function fetchJSON(path, signal, options = {}) {
  const response = await fetch(path, { ...options, signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw Error(payload?.error ?? path + ' could not be loaded (HTTP ' + response.status + ').');
  }
  return response.json();
}

function openMap(entry, route, draft, signal) {
  const canvas = $('map');
  const ctx = canvas.getContext('2d');
  const overlay = $('map-marker');
  const marker = overlay.getContext('2d');
  const points = route.waypoints;
  const hazards = route.hazards ?? [];
  const fields = ['x0', 'y0', 'x1', 'y1'];
  const margin = 1.15 / route.scale_m_per_u[0];
  const closeBounds = entry.id === 'airport' ? [-4.15, -.9, 3.35, 5.9]
    : route.zone.map((value, i) => value + (i < 2 ? -margin : margin));
  const extents = [...points, route.target];
  const wideBounds = [Math.min(...extents.map(p => p[0])) - 4, Math.min(...extents.map(p => p[1])) - 2.6,
    Math.max(...extents.map(p => p[0])) + 3.7, Math.max(...extents.map(p => p[1])) + 4.5];
  let area = draft?.area ?? route.area.slice();
  let proposedZones = draft?.proposedZones ?? [];
  let close = false;
  let picking = null;
  let firstCorner = null;
  let frame = 0;
  let view = 'clip';
  let projection;
  let painting;

  const message = text => { $('mapStatus').textContent = text; };
  const fill = () => fields.forEach((id, i) => { $(id).value = area[i]; });

  function drawMarker() {
    if (painting) return;
    painting = requestAnimationFrame(() => {
      painting = null;
      const [x, y] = projection.xy(route.frames[frame][1], route.frames[frame][2]);
      const heading = route.frames[frame][3] + (view === 'reverse' ? 180 : 0);
      marker.clearRect(0, 0, overlay.width, overlay.height);
      marker.save();
      marker.translate(x, y);
      marker.rotate(-heading * Math.PI / 180);
      marker.beginPath();
      marker.moveTo(17, 0);
      marker.lineTo(-10, -9);
      marker.lineTo(-6, 0);
      marker.lineTo(-10, 9);
      marker.closePath();
      marker.fillStyle = '#cd651f';
      marker.strokeStyle = '#fff';
      marker.lineWidth = 2;
      marker.fill();
      marker.stroke();
      marker.restore();
      if (firstCorner) {
        marker.fillStyle = '#a25420';
        marker.beginPath();
        marker.arc(...projection.xy(...firstCorner), 7, 0, 2 * Math.PI);
        marker.fill();
      }
    });
  }

  function drawBase() {
    const bounds = close ? closeBounds : wideBounds;
    const [west, south, east, north] = bounds;
    const width = canvas.width;
    const height = canvas.height;
    const scale = Math.min((width - 56) / (east - west), (height - 56) / (north - south));
    const left = (width - scale * (east - west)) / 2;
    const top = (height - scale * (north - south)) / 2;
    const xy = (x, y) => [left + (x - west) * scale, top + (north - y) * scale];
    projection = { bounds, scale, left, top, xy };

    function rectangle([minX, minY, maxX, maxY], fillColor, strokeColor) {
      if (minX > east || maxX < west || minY > north || maxY < south) return;
      const [x, y] = xy(minX, maxY);
      const w = (maxX - minX) * scale;
      const h = (maxY - minY) * scale;
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.3;
      ctx.strokeRect(x, y, w, h);
    }

    function dot(point, radius, fillColor, outline = fillColor) {
      ctx.beginPath();
      ctx.arc(...xy(point[0], point[1]), radius, 0, 2 * Math.PI);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, (east - west) * scale, (north - south) * scale);
    ctx.clip();
    const gap = close ? 1 : 4;
    for (let x = Math.ceil(west / gap) * gap; x < east; x += gap) {
      rectangle([x, south, x, north], 'transparent', '#d5dfd4');
    }
    for (let y = Math.ceil(south / gap) * gap; y < north; y += gap) {
      rectangle([west, y, east, y], 'transparent', '#d5dfd4');
    }
    rectangle(route.zone, '#dcead3', '#8ba682');
    for (const solid of route.map_solids) rectangle(solid.rect, '#b1bbb0', '#929e94');
    ctx.fillStyle = '#b1bbb0';
    ctx.strokeStyle = '#929e94';
    ctx.lineWidth = 1.2;
    for (const polygon of route.map_obstacles ?? []) {
      ctx.beginPath();
      for (const ring of polygon) {
        ctx.moveTo(...xy(...ring[0]));
        for (const corner of ring.slice(1)) ctx.lineTo(...xy(...corner));
        ctx.closePath();
      }
      ctx.fill('evenodd');
      ctx.stroke();
    }
    for (const zone of hazards) rectangle(zone.rect, '#dc8f7877', '#a24738');
    for (const rect of proposedZones) rectangle(rect, '#cf6e547f', '#a42d21');
    rectangle(route.area, '#82b9a2aa', '#266248');
    if (area.some((value, i) => value !== route.area[i])) rectangle(area, '#f4ad7788', '#a85d2d');

    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#296c55';
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      if (i) ctx.lineTo(...xy(x, y));
      else ctx.moveTo(...xy(x, y));
    });
    ctx.stroke();
    dot(points[0], 5, '#296c55');
    dot(route.stop, 5, '#296c55');
    dot(route.target, 7, '#fff', '#315c88');

    ctx.font = '600 21px system-ui';
    ctx.fillStyle = '#263e32';
    ctx.textAlign = 'center';
    const labels = entry.id === 'airport' && close
      ? [[-2.56, 5.12, 'Lottery'], [-1.51, 5.12, 'USPS'], [-.44, 5.12, 'FedEx'], [.78, 5.12, 'UPS']]
      : [[points[0][0], points[0][1] - .55, 'Start'], [route.target[0], route.target[1] + .42, 'Target']];
    for (const [x, y, label] of labels) ctx.fillText(label, ...xy(x, y));
    ctx.restore();
    drawMarker();
  }

  function cancelPick() {
    picking = null;
    firstCorner = null;
    for (const id of ['pick', 'block']) $(id).setAttribute('aria-pressed', 'false');
  }

  function mapDetail(zoom) {
    close = zoom;
    $('close').setAttribute('aria-pressed', String(close));
    $('wide').setAttribute('aria-pressed', String(!close));
    drawBase();
  }

  function coordinateValues() {
    return fields.map(id => $(id).valueAsNumber);
  }

  function validRectangle(rect) {
    return rect.every(Number.isFinite) && rect[2] - rect[0] >= .05 - 1e-10 && rect[3] - rect[1] >= .05 - 1e-10;
  }

  function validApproach(rect) {
    return validRectangle(rect) && rect[0] >= closeBounds[0] && rect[1] >= closeBounds[1]
      && rect[2] <= closeBounds[2] && rect[3] <= closeBounds[3];
  }

  function listen(id, action) {
    $(id).addEventListener('click', action, { signal });
  }

  for (const id of ['wide', 'close']) listen(id, () => {
    cancelPick();
    message('');
    mapDetail(id === 'close');
  });

  for (const id of ['pick', 'block']) listen(id, () => {
    const active = picking === id;
    cancelPick();
    if (active) {
      message('');
      drawMarker();
      return;
    }
    mapDetail(id === 'pick');
    picking = id;
    $(id).setAttribute('aria-pressed', 'true');
    message('Choose the first corner on the map.');
  });

  listen('map', event => {
    if (!picking) return;
    const { bounds, scale, left, top } = projection;
    const box = canvas.getBoundingClientRect();
    const x = bounds[0] + ((event.clientX - box.left) * canvas.width / box.width - left) / scale;
    const y = bounds[3] - ((event.clientY - box.top) * canvas.height / box.height - top) / scale;
    if (x < bounds[0] || x > bounds[2] || y < bounds[1] || y > bounds[3]) return;
    if (!firstCorner) {
      firstCorner = [x, y];
      message('Choose the opposite corner.');
      drawMarker();
      return;
    }
    const proposed = [Math.min(firstCorner[0], x), Math.min(firstCorner[1], y),
      Math.max(firstCorner[0], x), Math.max(firstCorner[1], y)].map(value => +value.toFixed(3));
    if (!(picking === 'pick' ? validApproach(proposed) : validRectangle(proposed))) {
      message('Choose two distinct corners within the map.');
      return;
    }
    if (picking === 'block') {
      if (proposedZones.length >= 32) {
        message('Use at most 32 proposed no-stop zones.');
        return;
      }
      proposedZones.push(proposed);
      message('Proposed no-stop zone marked.');
    } else {
      area = proposed;
      fill();
      message('Proposed approach area updated.');
    }
    cancelPick();
    drawBase();
  });

  listen('restore', () => {
    area = route.area.slice();
    proposedZones = [];
    cancelPick();
    fill();
    mapDetail(true);
    message('Original draft restored.');
  });
  listen('apply', () => {
    const proposed = coordinateValues();
    if (!validApproach(proposed)) {
      message('Enter a rectangle within the stop map, with distinct minimum and maximum coordinates.');
      return;
    }
    area = proposed;
    cancelPick();
    mapDetail(true);
    message('Proposed approach area updated.');
  });
  signal.addEventListener('abort', () => cancelAnimationFrame(painting), { once: true });

  message('');
  fill();
  mapDetail(false);
  return {
    locate(index, nextView) {
      frame = index;
      if (view !== nextView) {
        view = nextView;
        cancelPick();
        message('');
        mapDetail(['stop', 'reverse', 'approach'].includes(view));
      } else {
        drawMarker();
      }
    },
    reviewGeometry() {
      return picking || coordinateValues().some((value, i) => value !== area[i])
        ? null : { area: area.slice(), proposedZones: proposedZones.slice() };
    },
    draft: () => ({ area, proposedZones }),
  };
}

function openRunEvidence(entry, route, source, asset, signal) {
  $('scene-id').textContent = entry.scene_id;
  $('route-id').textContent = entry.route_id;
  $('source-revision').textContent = source.source_revision;
  $('poses-link').href = asset('trajectory.json');
  $('audit-link').href = asset('audit.json');
  $('receipt-link').href = asset('run.json');
  $('checks').textContent = route.states.length + ' executed actions · ' + route.frames.length
    + ' camera frames · ' + route.clearance_collision_events + ' recorded collisions';
  $('renderInfo').textContent = '';
  $('render-source').textContent = route.scale_basis || 'Scene scale estimated from the reconstruction.';

  let audit;
  function loadAudit() {
    audit ??= fetchJSON(asset('audit.json'), signal).catch(error => {
      audit = null;
      throw error;
    });
    return audit;
  }

  const details = $('run-evidence');
  details.open = false;
  details.addEventListener('toggle', async () => {
    if (!details.open) return;
    try {
      const a = await loadAudit();
      if (signal.aborted) return;
      $('renderInfo').textContent = a.floor_hits + ' of ' + a.floor_probes + ' floor probes found support. '
        + a.target_at_stop + '/' + a.rays_per_target + ' target sight lines are clear at STOP and '
        + a.target_reversed + '/' + a.rays_per_target + ' after a 180° turn.';
      const receipt = await fetchJSON(asset('run.json'), signal);
      if (!signal.aborted && receipt.render_source) {
        $('render-source').textContent = [route.scale_basis, receipt.render_source].filter(Boolean).join(' ');
      }
    } catch (error) {
      if (!signal.aborted) $('renderInfo').textContent = entry.id + ' · ' + error.message;
    }
  }, { signal });

  const memory = $('memory');
  memory.open = false;
  memory.hidden = !('memory' in source.key_frames);
  memory.addEventListener('toggle', async () => {
    if (!memory.open || memory.hidden) return;
    $('earlier-image').src = asset('preview/memory.webp');
    $('later-image').src = asset('preview/stop.webp');
    $('earlier-link').href = asset('memory.jpg');
    $('later-link').href = asset('stop.jpg');
    try {
      const a = await loadAudit();
      if (signal.aborted) return;
      $('earlier').textContent = 'Frame ' + a.keys.memory + ' · ' + a.visibility[a.keys.memory][1]
        + '/' + a.rays_per_target + ' sight lines reach the lottery machine.';
      $('later').textContent = 'Frame ' + a.keys.stop + ' · ' + a.lottery_at_stop
        + '/' + a.rays_per_target + ' sight lines reach it at the final stop.';
    } catch (error) {
      if (!signal.aborted) $('earlier').textContent = entry.id + ' · ' + error.message;
    }
  }, { signal });
  signal.addEventListener('abort', () => {
    $('earlier-image').removeAttribute('src');
    $('later-image').removeAttribute('src');
    $('earlier').textContent = '';
    $('later').textContent = '';
  }, { once: true });
}

const reviewStates = {
  pending: 'Pending human review',
  approve: 'Annotation approved',
  request_changes: 'Changes requested',
  loading: 'Checking review status',
  unavailable: 'Review unavailable',
};

function showError(message) {
  $('case-error').textContent = message;
  $('case-error').hidden = false;
}

async function ready() {
  const [catalog, media] = await Promise.all([
    fetchJSON('evaluation-candidates.json?v=3'), fetchJSON('review-media.json?v=3'),
  ]);
  const entries = new Map(catalog.cases.map(entry => [entry.id, entry]));
  const choose = $('case-select');
  const drafts = new Map();
  let active;
  for (const entry of entries.values()) choose.add(new Option(entry.title, entry.id));
  choose.disabled = false;

  async function open(caseId) {
    const entry = entries.get(caseId) ?? catalog.cases[0];
    active?.abort();
    active = new AbortController();
    const signal = active.signal;
    const source = media.cases[entry.id];
    const draftKey = entry.id + '/' + source?.source_revision;
    const asset = file => entry.assets + file + '?v=' + source.source_revision.slice(0, 12);
    const setState = state => {
      $('case-status').textContent = entry.title + ' · ' + reviewStates[state];
      const option = [...choose.options].find(item => item.value === entry.id);
      option.textContent = entry.title + (state === 'approve' ? ' · Approved'
        : state === 'request_changes' ? ' · Changes requested' : '');
    };

    choose.value = entry.id;
    $('case-content').hidden = true;
    $('case-error').hidden = true;
    setState('loading');
    document.querySelector('h1').textContent = entry.instruction;
    document.title = entry.title + ' · InStride Review';
    const [near, far] = entry.length_m_range;
    $('case-summary').textContent = entry.region_name + ' · ' + (near === far
      ? near.toFixed(2) + ' m executed' : near.toFixed(1) + '–' + far.toFixed(1) + ' m estimated');
    const scores = entry.geometric_checks;
    $('target-label').textContent = entry.target_label;
    $('target-part').textContent = entry.target_part;
    $('target-side').textContent = entry.operative_surface;
    const yaw = (entry.stop_yaw_deg % 360 + 360) % 360;
    $('final-heading').textContent = yaw.toFixed(1) + '° from +X toward +Y';
    const recordedPitch = typeof entry.stop_pitch_deg === 'number';
    $('final-pitch-label').hidden = !recordedPitch;
    $('final-pitch').hidden = !recordedPitch;
    if (recordedPitch) {
      const pitch = entry.stop_pitch_deg;
      $('final-pitch').textContent = Math.abs(pitch).toFixed(1) + '° ' + (pitch < 0 ? 'down' : 'up');
    }
    $('map-units').textContent = 'Top view · ' + (entry.coordinate_unit === 'm' ? 'meters' : 'scene units');
    $('stop-note').textContent = entry.stop_note;
    $('draft-score').textContent = (scores.region_entered ? 'Region entered' : 'Region missed') + ' · '
      + scores.approach_distance_m.toFixed(1) + ' m to the draft approach area · '
      + scores.distance_to_part_upper_m.toFixed(2) + ' m to the part at the upper scale estimate · '
      + scores.clear_rays + ' clear sight ' + (scores.clear_rays === 1 ? 'line' : 'lines')
      + ' · ' + scores.collision_events + ' collision steps';

    try {
      if (!source) throw Error('The review index is missing this scene.');
      const route = await fetchJSON(asset('trajectory.json'), signal);
      if (signal.aborted) return;
      if (route.id !== entry.route_id || route.frames.length !== source.frame_count) {
        throw Error('The route and its evidence index disagree.');
      }
      $('case-content').hidden = false;
      const map = openMap(entry, route, drafts.get(draftKey), signal);
      const player = openPlayback(entry, source, route, asset, map.locate, signal);
      openRunEvidence(entry, route, source, asset, signal);
      openReviewForm(entry, source, route, map, player, setState, signal);
      signal.addEventListener('abort', () => drafts.set(draftKey, map.draft()), { once: true });
    } catch (error) {
      if (signal.aborted) return;
      setState('unavailable');
      showError(entry.id + ' · ' + error.message);
    }
  }

  const currentCase = () => new URLSearchParams(location.search).get('case');
  choose.addEventListener('change', () => {
    const url = new URL(location.href);
    if (choose.value === catalog.cases[0].id) url.searchParams.delete('case');
    else url.searchParams.set('case', choose.value);
    history.pushState(null, '', url);
    open(choose.value);
  });
  window.addEventListener('popstate', () => open(currentCase()));
  return open(currentCase());
}

ready().catch(error => showError(error.message));
