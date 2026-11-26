function openPlayback(entry, source, route, asset, onFrame, signal) {
  const film = $('film');
  const still = $('hero');
  const play = $('start-playback');
  const quality = $('quality');
  const buttons = [...document.querySelectorAll('#views [data-key]')];
  const titles = {
    clip: 'Follow the robot through its turns and final alignment.',
    start: 'Robot view at departure.',
    turn: 'Robot view during a turn.',
    approach: 'Robot view while approaching the target.',
    stop: 'Final robot view facing ' + entry.target_label + '.',
    reverse: 'Comparison at the same position with the camera turned 180°.',
  };
  let view = 'clip';
  let frame = -1;
  let resolution = null;
  let previousTime = 0;
  let waitTimer;
  let streamAbort;
  let autoFallback = false;
  const times = route.frame_control_steps?.map(step => step / route.frame_time_hz);

  quality.value = loadPreference('instride-video-quality', 'auto');
  if (!quality.value) quality.value = 'auto';
  film.poster = asset('preview/start.webp');
  film.setAttribute('aria-label', 'First-person robot route in ' + entry.title);

  function automaticQuality() {
    const network = navigator.connection;
    return !autoFallback && network && !network.saveData && network.effectiveType === '4g'
      && network.downlink >= 7 && film.clientWidth >= 700 ? '1080' : '540';
  }

  function chosenQuality() {
    return quality.value === 'auto' ? automaticQuality() : quality.value;
  }

  function showMode() {
    $('mode').textContent = view === 'clip'
      ? (quality.value === 'auto' ? 'Auto · ' : '') + (resolution ?? chosenQuality()) + 'p'
      : 'Preview · 4K source available';
  }

  function showFrame(next, force = false) {
    if (next === frame && !force) return;
    frame = next;
    $('clock').textContent = 'Frame ' + frame + ' / ' + (source.frame_count - 1)
      + ' · ' + (times?.[frame] ?? frame / route.fps).toFixed(2) + ' s';
    onFrame(frame, view);
  }

  function synchronize(force = false) {
    if (view !== 'clip') return;
    const seconds = (film.readyState ? film.currentTime : previousTime) + 0.0001;
    let index = Math.floor(seconds * route.fps);
    if (times) {
      let low = 0;
      let high = times.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (times[middle] <= seconds) low = middle + 1;
        else high = middle;
      }
      index = low - 1;
    }
    showFrame(Math.min(source.frame_count - 1, Math.max(0, index)), force);
  }

  function tryPlay() {
    film.play().catch(error => {
      if (!signal.aborted && error.name !== 'AbortError' && !film.error) {
        $('caption').textContent = 'Press Play in the video controls to resume.';
      }
    });
  }

  function startStream(next, resume) {
    clearTimeout(waitTimer);
    if (resolution === next) {
      if (resume) tryPlay();
      return;
    }
    if (resolution && film.readyState) previousTime = film.currentTime;
    streamAbort?.abort();
    streamAbort = new AbortController();
    resolution = next;
    play.hidden = true;
    film.addEventListener('loadedmetadata', () => {
      if (previousTime > 0) {
        film.currentTime = Math.min(previousTime, film.duration);
      }
    }, { once: true, signal: streamAbort.signal });
    film.preload = 'metadata';
    film.src = asset(next === '540' ? 'expert-540p.mp4' : 'expert.mp4');
    film.load();
    if (resume) tryPlay();
    showMode();
  }

  function select(next) {
    view = next;
    film.pause();
    clearTimeout(waitTimer);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.key === view));
    const clip = view === 'clip';
    film.hidden = !clip;
    still.hidden = clip;
    play.hidden = !clip || !!resolution;
    $('quality').disabled = !clip;
    $('caption').textContent = titles[view];
    if (clip) {
      synchronize(true);
    } else {
      still.alt = titles[view];
      still.src = asset('preview/' + view + '.webp');
      showFrame(source.key_frames[view], true);
    }
    $('original').textContent = clip ? 'Open original video' : 'Open 4K image';
    $('original').href = asset(clip ? 'expert.mp4' : view + '.jpg');
    showMode();
  }

  for (const button of buttons) {
    button.addEventListener('click', () => select(button.dataset.key), { signal });
  }
  play.addEventListener('click', () => startStream(chosenQuality(), true), { signal });
  quality.addEventListener('change', () => {
    savePreference('instride-video-quality', quality.value);
    autoFallback = false;
    if (resolution) startStream(chosenQuality(), !film.paused && !film.ended);
    showMode();
  }, { signal });
  for (const event of ['timeupdate', 'seeked', 'ended']) {
    film.addEventListener(event, () => synchronize(), { signal });
  }
  for (const event of ['playing', 'pause', 'seeking', 'ended']) {
    film.addEventListener(event, () => clearTimeout(waitTimer), { signal });
  }
  film.addEventListener('waiting', () => {
    clearTimeout(waitTimer);
    if (quality.value !== 'auto' || resolution !== '1080' || film.seeking) return;
    waitTimer = setTimeout(() => {
      if (film.paused || film.seeking || film.readyState >= 3) return;
      autoFallback = true;
      startStream('540', true);
    }, 1400);
  }, { signal });
  film.addEventListener('error', () => {
    if (view !== 'clip') return;
    $('caption').textContent = 'Video could not load for ' + entry.title
      + '. Use the original video link or inspect the individual camera views.';
  }, { signal });
  still.addEventListener('error', () => {
    if (view !== 'clip') {
      $('caption').textContent = 'Preview missing for ' + entry.title + '. Try opening the original 4K image.';
    }
  }, { signal });
  signal.addEventListener('abort', () => {
    clearTimeout(waitTimer);
    streamAbort?.abort();
    film.pause();
    film.preload = 'none';
    film.removeAttribute('src');
    film.removeAttribute('poster');
    film.load();
    still.removeAttribute('src');
  }, { once: true });

  select('clip');
  return {
    locate: () => ({ view, frame_index: frame }),
  };
}
