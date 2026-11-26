function loadPreference(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

function savePreference(key, value) {
  try { localStorage.setItem(key, value); }
  catch { /* A browser can disable storage. A review can still be exported. */ }
}

function storedReviews(key) {
  try {
    const records = JSON.parse(loadPreference(key, '[]'));
    return Array.isArray(records) ? records : [];
  } catch { return []; }
}

function exportReview(record) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2) + '\n'],
    { type: 'application/json' }));
  link.href = url;
  link.download = record.case_id + '-annotation-review.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const reviewDrafts = new Map();

function openReviewForm(entry, source, route, map, player, onStatus, signal) {
  const server = !!document.querySelector('meta[name="review-mode"][content="server"]');
  const path = 'api/reviews/' + entry.id;
  const cacheKey = 'instride-annotation-reviews/' + entry.id;
  const draftKey = entry.id + '/' + source.source_revision;
  const draft = reviewDrafts.get(draftKey);
  let submission = draft?.submission;
  let records = [];
  const button = $('save');
  const form = $('review-form');
  const inputs = ['who', 'decision', 'note'];
  const checks = ['target', 'area'];

  for (const id of inputs) $(id).value = draft?.fields[id] ?? (id === 'who'
    ? loadPreference('instride-reviewer', '') : '');
  for (const id of checks) $('verify-' + id).checked = !!draft?.checked[id];
  $('msg').textContent = '';
  $('review-scope').textContent = server
    ? 'Pilot collection requires approval of the displayed revision.'
    : 'Export your decision to share it. Team approvals are recorded in the internal review tool.';
  button.textContent = server ? 'Save review' : 'Export review JSON';
  button.disabled = server;
  $('review-history').open = false;

  function show(state) {
    const label = $('review-state');
    label.dataset.state = state;
    label.textContent = ({
      pending: 'Pending review',
      approve: server ? 'Approved for pilot' : 'Approved on this device',
      request_changes: 'Changes requested',
      loading: 'Checking review status',
      unavailable: 'Review unavailable',
    })[state];
    onStatus(state);
  }

  function showHistory() {
    const items = records.slice().reverse().map(record => {
      const item = document.createElement('li');
      const prior = record.source_revision !== source.source_revision;
      item.textContent = (record.decision === 'approve' ? 'Approved' : 'Changes requested')
        + ' · ' + record.reviewer_id + ' · ' + record.submitted_at_utc.slice(0, 10)
        + (prior ? ' · Earlier revision ' + record.source_revision.slice(0, 10) : '')
        + (record.reason ? ' · ' + record.reason : '');
      return item;
    });
    $('history').replaceChildren(...items);
    $('review-history').hidden = items.length === 0;
    const current = records.slice().reverse().find(record => record.source_revision === source.source_revision);
    show(current ? current.decision : 'pending');
  }

  async function refresh() {
    if (server) {
      const status = await fetchJSON(path, signal);
      if (signal.aborted) return;
      if (status.source_revision !== source.source_revision) {
        throw Error('The evidence revision changed. Reload the scene before reviewing.');
      }
      records = status.history;
    } else {
      records = storedReviews(cacheKey);
    }
    showHistory();
  }

  show('loading');
  $('review-history').hidden = true;
  refresh().then(() => {
    if (!signal.aborted) button.disabled = false;
  }).catch(error => {
    if (!signal.aborted) {
      show('unavailable');
      $('msg').textContent = error.message;
    }
  });

  signal.addEventListener('abort', () => {
    reviewDrafts.set(draftKey, {
      submission,
      fields: Object.fromEntries(inputs.map(id => [id, $(id).value])),
      checked: Object.fromEntries(checks.map(id => [id, $('verify-' + id).checked])),
    });
  }, { once: true });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    const reviewer = $('who').value.trim();
    const decision = $('decision').value;
    const reason = $('note').value.trim();
    const geometry = map.reviewGeometry();
    const confirmation = { target: $('verify-target').checked, approach: $('verify-area').checked };
    const warn = message => { $('msg').textContent = message; };
    if (!reviewer || !decision) return warn('Enter a reviewer alias and select a decision.');
    if (decision === 'request_changes' && !reason) return warn('Explain what needs to change.');
    if (!geometry) return warn('Finish drawing and preview the approach area before saving.');

    const { area, proposedZones } = geometry;
    if (decision === 'approve') {
      if (!Object.values(confirmation).every(Boolean)) {
        return warn('Confirm both the target and the reachable area before approving.');
      }
      if (area.some((value, i) => value !== route.area[i]) || proposedZones.length) {
        return warn('Submit proposed geometry as a change request, then review the updated evidence.');
      }
      if ((route.hazards ?? []).some(({ rect }) => [0, 1].every(i => area[i] < rect[i + 2] && rect[i] < area[i + 2]))) {
        return warn('The source approach area overlaps a no-stop zone. Request a change.');
      }
    }

    const fields = {
      source_revision: source.source_revision,
      reviewer_id: reviewer,
      decision,
      reason,
      checks: confirmation,
      proposed_area_xyxy_u: area,
      proposed_no_stop_zones_xyxy_u: proposedZones,
      evidence_locator: player.locate(),
    };
    const signature = JSON.stringify(fields);
    if (signature !== submission?.signature) submission = { signature, id: crypto.randomUUID() };
    const payload = { review_id: submission.id, ...fields };
    button.disabled = true;
    try {
      if (server) {
        await fetchJSON(path, signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        await refresh();
      } else {
        const current = storedReviews(cacheKey);
        const saved = current.find(record => record.review_id === payload.review_id);
        const record = saved ?? {
          ...payload,
          schema: 'instride-annotation-review/1',
          subject_type: 'task_candidate',
          subject_id: entry.id,
          case_id: entry.id,
          scene_id: entry.scene_id,
          route_id: entry.route_id,
          submitted_at_utc: new Date().toISOString(),
        };
        records = saved ? current : [...current, record];
        savePreference(cacheKey, JSON.stringify(records));
        showHistory();
        exportReview(record);
      }
      savePreference('instride-reviewer', reviewer);
      if (!signal.aborted) warn(server ? 'Review saved.' : 'Review JSON exported.');
    } catch (error) {
      if (!signal.aborted) {
        warn(error.message);
      }
    } finally {
      if (!signal.aborted) button.disabled = false;
    }
  }, { signal });
}
